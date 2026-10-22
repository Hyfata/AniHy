// swift-tools-version:5.9
import PackageDescription

// NOTE(빌드 머신 확인 필요): "Tauri" SPM 패키지 경로는 `tauri ios init` 실행 후
// 생성되는 src-tauri/gen/apple 산출물에 맞춰야 한다. 공식 플러그인 템플릿의
// 상대 경로("../.tauri/tauri-api")를 따륐 — init 후 경로가 다륩면 여기를 수정.
let package = Package(
    name: "tauri-plugin-anihy-tabs",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "tauri-plugin-anihy-tabs", type: .static, targets: ["tauri-plugin-anihy-tabs"])
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-anihy-tabs",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources"
        )
    ]
)
