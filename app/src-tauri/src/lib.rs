mod downloads;

/// 번들된 부트스트랩 페이지(ui/index.html)가 invoke로 읽어가는 서버 URL.
/// 빌드 시 ANIHY_SERVER_URL 환경변수로 고정된다 (build.rs 참고).
#[tauri::command]
fn get_server_url() -> String {
    env!("ANIHY_SERVER_URL").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_anihy_tabs::init())
        // 오프라인 재생용 커스텀 프로토콜 (anihy://localhost/..., Range 지원)
        .register_uri_scheme_protocol("anihy", downloads::handle_protocol)
        .setup(|app| {
            downloads::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            downloads::download_episode,
            downloads::download_all,
            downloads::cancel_download,
            downloads::delete_episode,
            downloads::delete_anime,
            downloads::delete_all_downloads,
            downloads::list_downloads,
            downloads::record_local_history,
            downloads::get_local_history,
            downloads::pending_history_count,
            downloads::sync_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AniHy application");
}
