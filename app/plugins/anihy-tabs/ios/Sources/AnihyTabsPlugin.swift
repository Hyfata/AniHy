import SwiftRs
import Tauri
import UIKit
import WebKit

// MARK: - Args

struct TabSpec: Decodable {
    let id: String
    let label: String
    let icon: String // SF Symbol 이름 (예: "house", "calendar", "magnifyingglass", "square.stack")
}

class SetTabsArgs: Decodable {
    let tabs: [TabSpec]
}

class SelectTabArgs: Decodable {
    let id: String
}

class WatchTabSelectedArgs: Decodable {
    let onSelected: Channel
}

class WatchInsetsArgs: Decodable {
    let onInsets: Channel
}

// MARK: - Tab bar controller delegate shim

/// UITabBar 선택 콜백을 클로저로 연결하기 위한 델리게이트 프록시.
class TabBarDelegateProxy: NSObject, UITabBarDelegate {
    var onSelect: ((Int) -> Void)?

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        onSelect?(item.tag)
    }
}

// MARK: - Plugin

/// AniHy 네이티브 탭바 플러그인 (iOS).
/// 웹뷰 위에 UITabBar를 오버레이하고, 탭 선택/safe-area inset을 JS 채널로 푸시한다.
/// 웹 콘텐츠는 하단 inset을 CSS 변수(--anihy-sab)로 받아 탭바 높이만큼 패딩을 넣는다.
class AnihyTabsPlugin: Plugin {
    private var tabBar: UITabBar?
    private let delegateProxy = TabBarDelegateProxy()
    private var tabs: [TabSpec] = []
    private var tabSelectedChannel: Channel?
    private var insetsChannel: Channel?
    private var insetsObserver: NSObjectProtocol?

    deinit {
        if let observer = insetsObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    // MARK: Commands

    @objc public func setTabs(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SetTabsArgs.self)
        self.tabs = args.tabs
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.installTabBar()
            invoke.resolve()
        }
    }

    @objc public func selectTab(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SelectTabArgs.self)
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let tabBar = self.tabBar else {
                invoke.resolve()
                return
            }
            if let index = self.tabs.firstIndex(where: { $0.id == args.id }),
               let items = tabBar.items, index < items.count {
                tabBar.selectedItem = items[index]
            }
            invoke.resolve()
        }
    }

    @objc public func getInsets(_ invoke: Invoke) throws {
        DispatchQueue.main.async { [weak self] in
            invoke.resolve(self?.currentInsets() ?? ["top": 0, "right": 0, "bottom": 0, "left": 0])
        }
    }

    @objc public func watchTabSelected(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WatchTabSelectedArgs.self)
        self.tabSelectedChannel = args.onSelected
        invoke.resolve()
    }

    @objc public func watchInsets(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(WatchInsetsArgs.self)
        self.insetsChannel = args.onInsets
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                invoke.resolve()
                return
            }
            // 즉시 현재 값 1회 전달
            self.pushInsets()
            // safe-area 변화(회전, 상태바 hide/show 등) 감지:
            // view의 safeAreaInsetsDidChange를 직접 훅할 수 없으므로
            // 회전/리사이즈 알림 + 주기적 레이아웃 이벤트로 근사한다.
            // TODO(빌드 머신 검증): Tauri viewController에 KVO(safeAreaInsets)를
            // 걸 수 있으면 그쪽으로 교체.
            if self.insetsObserver == nil {
                self.insetsObserver = NotificationCenter.default.addObserver(
                    forName: UIDevice.orientationDidChangeNotification,
                    object: nil,
                    queue: .main
                ) { [weak self] _ in
                    // 회전 완료 후 inset이 확정되도록 한 틱 뒤에 푸시
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        self?.pushInsets()
                    }
                }
            }
            invoke.resolve()
        }
    }

    // MARK: Tab bar

    private func installTabBar() {
        guard let viewController = self.manager.viewController else { return }

        // 기존 탭바가 있으면 제거 후 재구성 (setTabs 재호출 대응)
        tabBar?.removeFromSuperview()

        let bar = UITabBar()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.delegate = delegateProxy

        bar.items = tabs.enumerated().map { index, tab in
            let image = UIImage(systemName: tab.icon)
            let item = UITabBarItem(title: tab.label, image: image, tag: index)
            return item
        }
        if let first = bar.items?.first {
            bar.selectedItem = first
        }

        delegateProxy.onSelect = { [weak self] index in
            guard let self = self, index < self.tabs.count else { return }
            // TODO(빌드 머신 검증): Channel 전송 API가 버전에 따라
            // send(_:) / sendChannelData(_:) 등으로 다를 수 있음
            try? self.tabSelectedChannel?.send(["id": self.tabs[index].id])
            // 사용자가 직접 탭을 눌렀으므로 네이티브 선택 상태는 UITabBar가 이미 반영함
            self.pushInsets()
        }

        viewController.view.addSubview(bar)
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: viewController.view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: viewController.view.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: viewController.view.bottomAnchor),
        ])

        self.tabBar = bar
        pushInsets()
    }

    // MARK: Insets

    /// 웹에 전달할 inset (pt 단위 — WKWebView의 CSS px과 1:1).
    /// bottom은 OS safe-area + 탭바 높이를 합산한다 (탭바가 오버레이이므로).
    private func currentInsets() -> [String: Double] {
        guard let viewController = self.manager.viewController else {
            return ["top": 0, "right": 0, "bottom": 0, "left": 0]
        }
        let safe = viewController.view.safeAreaInsets
        let tabBarHeight = tabBar?.bounds.height ?? 0
        return [
            "top": Double(safe.top),
            "right": Double(safe.right),
            "bottom": Double(safe.bottom + tabBarHeight),
            "left": Double(safe.left),
        ]
    }

    private func pushInsets() {
        // 레이아웃 확정 후 값을 읽기 위해 강제 레이아웃
        self.manager.viewController?.view.layoutIfNeeded()
        try? insetsChannel?.send(currentInsets())
    }
}

@_cdecl("init_plugin_anihy_tabs")
func initPlugin() -> Plugin {
    return AnihyTabsPlugin()
}
