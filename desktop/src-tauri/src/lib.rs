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
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, get_backend_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
