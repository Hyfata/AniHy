const COMMANDS: &[&str] = &[
    "set_tabs",
    "select_tab",
    "get_insets",
    "watch_tab_selected",
    "watch_insets",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
