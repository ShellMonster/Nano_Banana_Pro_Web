use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_opener::OpenerExt;
use tauri::{Emitter, State, Manager};
use std::sync::{Arc, Mutex};
use std::path::{Path, PathBuf};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};
use std::process::Command;

#[derive(Clone, serde::Serialize)]
struct PortPayload {
    port: u16,
}

struct BackendPort(Arc<Mutex<u16>>);
struct SidecarState(Arc<Mutex<Option<CommandChild>>>);

#[derive(Clone)]
struct LogWriter {
    path: PathBuf,
    file: Arc<Mutex<Option<std::fs::File>>>,
}

impl LogWriter {
    fn new(path: PathBuf) -> Self {
        let file = Arc::new(Mutex::new(None));
        Self { path, file }
    }

    fn open(&self) {
        let mut guard = self.file.lock().unwrap();
        if guard.is_some() {
            return;
        }
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = rotate_if_too_large(&self.path, 5 * 1024 * 1024, 5);
        match OpenOptions::new().create(true).append(true).open(&self.path) {
            Ok(f) => {
                *guard = Some(f);
            }
            Err(_) => {
                *guard = None;
            }
        }
    }

    fn write_line(&self, line: &str) {
        // lazy open
        if self.file.lock().unwrap().is_none() {
            self.open();
        }

        let mut guard = self.file.lock().unwrap();
        let Some(f) = guard.as_mut() else { return };
        let sanitized = line.replace('\r', "").trim_end_matches('\n').to_string();
        if sanitized.is_empty() {
            return;
        }
        let _ = writeln!(f, "{}", sanitized);
        let _ = f.flush();
    }
}

#[derive(Clone)]
struct LogState {
    dir: PathBuf,
    app: LogWriter,
    server: LogWriter,
}

impl LogState {
    fn init(app: &tauri::AppHandle) -> Self {
        let base = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        let dir = base.join("logs");
        let app_log = LogWriter::new(dir.join("app.log"));
        let server_log = LogWriter::new(dir.join("server.log"));

        app_log.open();
        server_log.open();

        let header = format!(
            "[{}] [INFO] session start name={} version={} os={} arch={}",
            now_ms(),
            app.package_info().name,
            app.package_info().version,
            std::env::consts::OS,
            std::env::consts::ARCH
        );
        app_log.write_line(&header);

        Self { dir, app: app_log, server: server_log }
    }

    fn log_app(&self, level: &str, message: &str) {
        let line = format!("[{}] [{}] {}", now_ms(), level, message);
        self.app.write_line(&line);
    }

    fn log_server(&self, stream: &str, message: &str) {
        let line = format!("[{}] [{}] {}", now_ms(), stream, message);
        self.server.write_line(&line);
    }
}

#[derive(serde::Deserialize)]
struct FrontendLogEntry {
    level: String,
    message: String,
    context: Option<String>,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn rotate_if_too_large(path: &Path, max_bytes: u64, keep: usize) -> std::io::Result<()> {
    let Ok(meta) = fs::metadata(path) else { return Ok(()) };
    if meta.len() <= max_bytes {
        return Ok(());
    }

    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("log");
    let ts = now_ms();
    let rotated = parent.join(format!("{}-{}.log", stem, ts));
    let _ = fs::rename(path, rotated);

    // cleanup old rotated logs
    let mut rotated_files: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    if let Ok(entries) = fs::read_dir(parent) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if !name.starts_with(&format!("{}-", stem)) || !name.ends_with(".log") {
                continue;
            }
            if let Ok(m) = entry.metadata() {
                if let Ok(modified) = m.modified() {
                    rotated_files.push((modified, p));
                }
            }
        }
    }
    rotated_files.sort_by_key(|(t, _)| *t);
    if rotated_files.len() > keep {
        let extra = rotated_files.len() - keep;
        for (_, p) in rotated_files.into_iter().take(extra) {
            let _ = fs::remove_file(p);
        }
    }

    Ok(())
}

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

// 获取日志目录，便于用户导出/提交诊断日志
#[tauri::command]
fn get_log_dir(state: State<'_, LogState>) -> String {
    let _ = fs::create_dir_all(&state.dir);
    state.dir.to_string_lossy().to_string()
}

// 打开日志目录
#[tauri::command]
fn open_log_dir(app: tauri::AppHandle, state: State<'_, LogState>) -> Result<(), String> {
    let _ = fs::create_dir_all(&state.dir);
    let open_result = app
        .opener()
        .open_path(state.dir.to_string_lossy().to_string(), None::<String>);

    if let Err(err) = open_result {
        open_dir_with_command(&state.dir)
            .map_err(|fallback| format!("open log dir failed: {} ({})", err, fallback))?;
    }
    Ok(())
}

fn open_dir_with_command(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("open command failed: {}", e))
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("explorer command failed: {}", e))
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("xdg-open command failed: {}", e))
    }
}

// 写入前端日志（批量），用于捕获前端异常与关键调试信息
#[tauri::command]
fn write_frontend_logs(state: State<'_, LogState>, entries: Vec<FrontendLogEntry>) -> Result<(), String> {
    // 防御：避免日志被塞入超大 payload
    const MAX_ENTRIES: usize = 200;
    const MAX_LINE_CHARS: usize = 4000;

    for entry in entries.into_iter().take(MAX_ENTRIES) {
        let level = entry.level.trim().to_uppercase();
        let mut msg = entry.message.replace('\r', "").replace('\n', "\\n");
        if msg.len() > MAX_LINE_CHARS {
            msg.truncate(MAX_LINE_CHARS);
            msg.push_str("…(truncated)");
        }

        let ctx = entry.context.unwrap_or_default().replace('\r', "").replace('\n', "\\n");
        let mut line = format!("[{}] [FE] [{}] {}", now_ms(), level, msg);
        if !ctx.trim().is_empty() {
            if line.len() + ctx.len() + 4 <= MAX_LINE_CHARS {
                line.push_str(" | ");
                line.push_str(ctx.trim());
            }
        }

        state.app.write_line(&line);
    }
    Ok(())
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

// 复制文本到系统剪贴板（用于日志路径等）
#[tauri::command]
fn copy_text_to_clipboard(app: tauri::AppHandle, text: String) -> Result<(), String> {
    use std::sync::mpsc;

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("text is empty".to_string());
    }

    let content = trimmed.to_string();
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let result = (|| {
            let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("clipboard init failed: {}", e))?;
            clipboard
                .set_text(content)
                .map_err(|e| format!("clipboard set text failed: {}", e))?;
            Ok(())
        })();
        let _ = tx.send(result);
    })
    .map_err(|e| format!("run_on_main_thread failed: {}", e))?;

    rx.recv().map_err(|_| "clipboard task aborted".to_string())?
}
// 从系统剪贴板读取图片并写入 AppData 临时文件（用于打包环境下 Web ClipboardData 不可用/不稳定的兜底）
#[tauri::command]
fn read_image_from_clipboard(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use std::sync::mpsc;

    // macOS 上部分剪贴板实现要求在主线程调用：统一切主线程读剪贴板
    let (tx, rx) = mpsc::channel::<Result<Option<(usize, usize, Vec<u8>)>, String>>();
    app.run_on_main_thread(move || {
        let result = (|| {
            let mut clipboard =
                arboard::Clipboard::new().map_err(|e| format!("clipboard init failed: {}", e))?;
            match clipboard.get_image() {
                Ok(img) => Ok(Some((img.width, img.height, img.bytes.into_owned()))),
                Err(e) => {
                    eprintln!("clipboard get_image failed: {}", e);
                    Ok(None)
                }
            }
        })();
        let _ = tx.send(result);
    })
    .map_err(|e| format!("run_on_main_thread failed: {}", e))?;

    let Some((width, height, bytes)) = rx
        .recv()
        .map_err(|_| "clipboard task aborted".to_string())?? else {
        return Ok(None);
    };

    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let dir = base.join("clipboard");
    fs::create_dir_all(&dir).map_err(|e| format!("create clipboard dir failed: {}", e))?;

    let out_path = dir.join(format!("clipboard-{}.png", now_ms()));
    let w = width as u32;
    let h = height as u32;
    let buffer = image::ImageBuffer::<image::Rgba<u8>, Vec<u8>>::from_raw(w, h, bytes)
        .ok_or_else(|| "invalid clipboard image data".to_string())?;
    buffer
        .save(&out_path)
        .map_err(|e| format!("save clipboard image failed: {}", e))?;

    Ok(Some(out_path.to_string_lossy().to_string()))
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn kill_sidecar(app_handle: &tauri::AppHandle) {
    let sidecar_state = app_handle.state::<SidecarState>();
    let log_state = app_handle.state::<LogState>();
    let mut guard = sidecar_state.0.lock().unwrap();
    if let Some(child) = guard.take() {
        log_state.log_app("INFO", "Killing sidecar process on app exit.");
        if let Err(err) = child.kill() {
            log_state.log_app("ERROR", &format!("Failed to kill sidecar: {}", err));
        }
    }
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(BackendPort(port_state_for_state))
        .setup(move |app| {
            let log_state = LogState::init(&app.handle());
            app.manage(log_state.clone());

            let shell = app.shell();
            let sidecar_command = shell.sidecar("server")
                .unwrap()
                .env("TAURI_PLATFORM", "macos")
                .env("TAURI_FAMILY", "unix")
                .env("GODEBUG", "http2debug=2") 
                .env("GIN_MODE", "release");
            
            println!("Attempting to spawn sidecar...");
            log_state.log_app("INFO", "Attempting to spawn sidecar...");
            
            let (mut rx, child) = sidecar_command
                .spawn()
                .expect("Failed to spawn sidecar");

            println!("Sidecar spawned with PID: {:?}", child.pid());
            log_state.log_app("INFO", &format!("Sidecar spawned with PID: {:?}", child.pid()));

            let sidecar_state = Arc::new(Mutex::new(Some(child)));
            app.manage(SidecarState(sidecar_state.clone()));
            let child_clone = sidecar_state.clone();

            let app_handle = app.handle().clone();
            let port_state_inner = port_state_for_setup.clone();
            let log_state_for_task = log_state.clone();
            
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let out = String::from_utf8_lossy(&line);
                            println!("Sidecar STDOUT: {}", out);
                            log_state_for_task.log_server("STDOUT", out.trim_end());
                            
                            if out.contains("SERVER_PORT=") {
                                if let Some(port_str) = out.split('=').last() {
                                    if let Ok(port) = port_str.trim().parse::<u16>() {
                                        println!("Detected backend port: {}", port);
                                        log_state_for_task.log_app("INFO", &format!("Detected backend port: {}", port));
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
                            let err = String::from_utf8_lossy(&line);
                            eprintln!("Sidecar STDERR: {}", err);
                            log_state_for_task.log_server("STDERR", err.trim_end());
                        }
                        CommandEvent::Error(err) => {
                            eprintln!("Sidecar Error: {}", err);
                            log_state_for_task.log_app("ERROR", &format!("Sidecar Error: {}", err));
                        }
                        CommandEvent::Terminated(status) => {
                            println!("Sidecar Terminated with status: {:?}", status);
                            log_state_for_task.log_app("WARN", &format!("Sidecar Terminated with status: {:?}", status));
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
            get_log_dir,
            open_log_dir,
            write_frontend_logs,
            copy_image_to_clipboard,
            copy_text_to_clipboard,
            read_image_from_clipboard
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit { .. } => {
                    kill_sidecar(app_handle);
                }
                _ => {}
            }
        });
}
