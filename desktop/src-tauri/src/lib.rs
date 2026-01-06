use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri::{Emitter, State, Manager};
use std::sync::{Arc, Mutex};

#[derive(Clone, serde::Serialize)]
struct PortPayload {
    port: u16,
}

struct BackendPort(Arc<Mutex<u16>>);

// 获取后端实际运行端口的命令
#[tauri::command]
fn get_backend_port(state: State<'_, BackendPort>) -> u16 {
    let port = state.0.lock().unwrap();
    *port
}

// 获取应用数据目录的命令，用于前端拼接本地图片路径
#[tauri::command]
fn get_app_data_dir(app: tauri::AppHandle) -> String {
    app.path().app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

// 将本地图片写入系统剪贴板（用于 macOS 打包环境下 Web Clipboard API 不可用/不稳定的兜底）
#[tauri::command]
fn copy_image_to_clipboard(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use std::borrow::Cow;
    use std::path::PathBuf;
    use std::sync::mpsc;

    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path is empty".to_string());
    }

    // 兼容 file:// URL（可能包含 host=localhost）
    let normalized = if let Some(p) = trimmed.strip_prefix("file://localhost") {
        p.to_string()
    } else if let Some(p) = trimmed.strip_prefix("file://") {
        p.to_string()
    } else {
        trimmed.to_string()
    };

    let input_path = PathBuf::from(normalized);

    // 兼容：后端历史可能存的是相对路径（如 storage/xxx.jpg），打包/开发环境工作目录也可能不同
    let mut candidates: Vec<PathBuf> = Vec::new();
    if input_path.is_absolute() {
        candidates.push(input_path);
    } else {
        if let Ok(app_data) = app.path().app_data_dir() {
            candidates.push(app_data.join(&input_path));
        }
        if let Ok(current_dir) = std::env::current_dir() {
            candidates.push(current_dir.join(&input_path));
        }
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(resource_dir.join(&input_path));
        }
        // 最后再尝试“原样相对路径”（少数场景下当前目录就是预期目录）
        candidates.push(input_path);
    }

    let file_path = candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .unwrap_or_else(|| candidates.first().cloned().unwrap());

    let bytes = std::fs::read(&file_path)
        .map_err(|e| format!("read file failed: {} ({})", e, file_path.display()))?;

    let img = image::load_from_memory(&bytes).map_err(|e| format!("decode image failed: {}", e))?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let raw = rgba.into_raw();

    // macOS 上部分剪贴板实现要求在主线程调用，这里强制切到主线程执行，避免偶发失败
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let result = (|| {
            let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("clipboard init failed: {}", e))?;
            clipboard
                .set_image(arboard::ImageData {
                    width: width as usize,
                    height: height as usize,
                    bytes: Cow::Owned(raw),
                })
                .map_err(|e| format!("clipboard set image failed: {}", e))?;
            Ok(())
        })();

        let _ = tx.send(result);
    })
    .map_err(|e| format!("run_on_main_thread failed: {}", e))?;

    rx.recv().map_err(|_| "clipboard task aborted".to_string())?
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port_state = Arc::new(Mutex::new(0u16)); // 初始为 0
    let port_state_for_setup = port_state.clone();
    let port_state_for_state = port_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(BackendPort(port_state_for_state))
        .setup(move |app| {
            let shell = app.shell();
            let sidecar_command = shell.sidecar("server")
                .unwrap()
                .env("TAURI_PLATFORM", "macos")
                .env("TAURI_FAMILY", "unix")
                .env("GODEBUG", "http2debug=2") 
                .env("GIN_MODE", "release");
            
            println!("Attempting to spawn sidecar...");
            
            let (mut rx, child) = sidecar_command
                .spawn()
                .expect("Failed to spawn sidecar");

            println!("Sidecar spawned with PID: {:?}", child.pid());

            let child_for_exit = Arc::new(Mutex::new(Some(child)));
            let child_clone = child_for_exit.clone();

            let app_handle = app.handle().clone();
            let port_state_inner = port_state_for_setup.clone();
            
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let out = String::from_utf8_lossy(&line);
                            println!("Sidecar STDOUT: {}", out);
                            
                            if out.contains("SERVER_PORT=") {
                                if let Some(port_str) = out.split('=').last() {
                                    if let Ok(port) = port_str.trim().parse::<u16>() {
                                        println!("Detected backend port: {}", port);
                                        if let Ok(mut p) = port_state_inner.lock() {
                                            *p = port;
                                        }
                                        // 依然发送事件，以便正在运行的页面能立即感知
                                        let _ = app_handle.emit("backend-port", PortPayload { port });
                                    }
                                }
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("Sidecar STDERR: {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(err) => {
                            eprintln!("Sidecar Error: {}", err);
                        }
                        CommandEvent::Terminated(status) => {
                            println!("Sidecar Terminated with status: {:?}", status);
                            // 进程退出了，清空 handle
                            if let Ok(mut c) = child_clone.lock() {
                                *c = None;
                            }
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_backend_port,
            get_app_data_dir,
            copy_image_to_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
