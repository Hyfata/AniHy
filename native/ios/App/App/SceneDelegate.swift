import UIKit
import Capacitor

class AniHyBridgeViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        // safe area 인셋 이중 적용 방지 (페이지가 viewport-fit=cover + env()로 직접 처리)
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        // OS 기본 러버밴드 바운스 명시적 활성화 (기본값 true지만 방어적으로 고정)
        webView?.scrollView.bounces = true
        webView?.scrollView.alwaysBounceVertical = true
    }

    // iOS 26+ 버그(WebKit 297779, capacitor#8231) 우회: 전체화면 해제·회전 후
    // WebKit이 safe area/뷰포트 재계산을 못 해 상단에 빈 영역이 생기거나
    // fixed 요소가 OS 상태바와 겹치는 문제. 네이티브에서 WebView 프레임을
    // 재설정해 레이아웃 재계산을 강제한다.
    private func forceWebViewRelayout() {
        guard let webView = webView else { return }
        webView.frame = view.bounds
        webView.setNeedsLayout()
        webView.layoutIfNeeded()
        // JS 쪽(env/safe-area 의존 레이아웃)에도 resize 통지
        webView.evaluateJavaScript("window.dispatchEvent(new Event('resize'))", completionHandler: nil)
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            self?.forceWebViewRelayout()
        }
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        // 상태바 hide/show 등 inset 변화 후 프레임이 어긋난 경우만 복원
        if let webView = webView, webView.frame != view.bounds {
            forceWebViewRelayout()
        }
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AniHyBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
