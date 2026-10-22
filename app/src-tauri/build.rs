fn main() {
    // 빌드 시점 환경변수 ANIHY_SERVER_URL을 바이너리에 고정 (기본값은 플레이스홀더).
    // 실서버 URL이 코드에 들어가므로 CI/공개 머신에서 빌드할 때 주의 — README 참고.
    let url = std::env::var("ANIHY_SERVER_URL")
        .unwrap_or_else(|_| "https://anime.hyfata.kr".to_string());
    println!("cargo:rustc-env=ANIHY_SERVER_URL={url}");
    println!("cargo:rerun-if-env-changed=ANIHY_SERVER_URL");

    tauri_build::build()
}
