package platform

import "os"

func IsTauriSidecar() bool {
	return os.Getenv("TAURI_PLATFORM") != "" || os.Getenv("TAURI_FAMILY") != ""
}
