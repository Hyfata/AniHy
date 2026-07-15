# AniHy

Crunchyroll이나 Hidive에서 애니메이션을 다운로드하고 자막과 합성하여 웹에서 스트리밍할 수 있는 PHP 기반 개인용 애니 스트리밍 사이트입니다.

## 개요

- **서비스 언어**: 한국어
- **진입점**: `/anime/` (Apache 서브 디렉터리로 동작)
- 관리자 로그인 후 애니메이션과 에피소드를 등록·수정·삭제할 수 있습니다.
- 에피소드 등록 시 Crunchyroll/Hidive 시즌 ID를 입력하면 백그라운드에서 다운로드 → 복호화 → 자막 처리 → MP4 변환이 진행됩니다.
- 서버에 이미 있는 파일(예: Transmission 다운로드 폴터)을 선택해 변환할 수도 있습니다.

## 기술 스택

| 구성 요소 | 사용 기술 |
|-----------|-----------|
| 백엔드 | PHP 8.4 |
| 데이터베이스 | MariaDB / MySQL |
| 웹 서버 | Apache |
| 프론트엔드 | Vanilla JS, CSS3, Video.js 8.10.0 |
| 미디어 처리 | ffmpeg 6.x, Bento4(mp4decrypt), Intel VA-API |
| 다운로더 | [multi-downloader-nx](https://github.com/anidl/multi-downloader-nx) 5.7.4 (Crunchyroll/Hidive 지원) |

## 디렉터리 구조

```
/var/www/html/anime/
├── .apache/            # Apache 접근 제어 설정 (anihy.conf)
├── admin/              # 관리자 로그인/로그아웃
├── animes/             # 최종 변환된 에피소드 MP4 저장소
├── api/                # AJAX API 엔드포인트
├── assets/             # CSS, JS, 폰트
├── covers/             # 애니 커버 이미지
├── downloader/         # aniDL 바이너리 및 설정
├── inc/                # 공통 PHP 모듈
├── logs/               # worker 작업 로그
├── sql/                # 데이터베이스 초기화 스크립트
├── subtitles/          # 변환된 ASS 자막 저장소
├── worker/             # 백그라운드 변환 워커
├── anime.php           # 애니 상세 + 에피소드 목록
├── auth_gate.php       # 접근 인증번호 입력 페이지
├── index.php           # 홈
├── watch.php           # 에피소드 시청 페이지
└── ass_ruby_fix.py     # ASS <ruby> 태그 변환 스크립트
```

## 설치 및 실행

### 사전 요구 사항

- PHP 8.4+ (CLI 포함)
- MariaDB / MySQL
- Apache
- ffmpeg 6.x
- Node.js 22+ / pnpm 10+ (aniDL 소스 빌드 시)
- `nohup`, `shell_exec` 사용 가능한 PHP 실행 환경

### 초기 설정

1. 데이터베이스 생성:

   ```bash
   mysql -u root -p < sql/init.sql
   ```

2. `inc/db.php`의 DB 접속 정보를 실제 환경에 맞게 수정합니다.

3. `logs/`, `animes/`, `covers/`, `subtitles/`, `downloader/videos/` 디렉터리에 웹 서버 쓰기 권한이 있는지 확인합니다.

4. Apache에서 `/var/www/html/anime`을 `/anime/` 경로로 연결합니다:

   ```apache
   Alias /anime /var/www/html/anime
   <Directory /var/www/html/anime>
       Options -Indexes +FollowSymLinks
       AllowOverride All
       Require all granted
   </Directory>
   ```

기본 관리자 계정은 `inc/auth.php`에 하드코딩되어 있습니다.

### 접근 제어 설정

AniHy는 `/anime/` 하위 모든 콘텐츠에 대해 인증번호 기반 접근 제어를 제공합니다.

1. `.apache/anihy.conf`를 시스템 Apache 설정으로 복사하고 활성화합니다.

   ```bash
   sudo cp /var/www/html/anime/.apache/anihy.conf /etc/apache2/conf-available/anihy.conf
   sudo a2enconf anihy
   sudo systemctl reload apache2
   ```

2. `sql/init.sql`에 포함된 `settings` 테이블이 생성되었는지 확인합니다.

3. 기본 접근 인증번호는 `0000`입니다. 관리자 로그인 후 상단 메뉴의 **인증번호**에서 변경하세요.

4. 인증번호와 쿠키 서명용 비밀키는 DB의 `settings` 테이블에 저장됩니다. 저장소에 민감값이 노출되지 않도록 이 파일들은 커밋하지 마세요.

## 개발

### downloader 설정

`downloader/` 폴터에는 [multi-downloader-nx](https://github.com/anidl/multi-downloader-nx) 저장소의 파일들을 주입해야 합니다. 해당 프로젝트를 클론 또는 빌드한 뒤, 바이너리 및 `config/` 파일들을 `downloader/` 아래에 배치하세요.

예시:

```bash
cd /var/www/html/anime/downloader
# multi-downloader-nx 클론 및 빌드 후 파일 복사
git clone https://github.com/anidl/multi-downloader-nx.git /tmp/multi-downloader-nx
cp -r /tmp/multi-downloader-nx/* /var/www/html/anime/downloader/
```

### inc 모듈 설정

`inc/` 폴터 안의 `.inc` 파일들은 뒤의 `.inc` 확장자를 제거하고, 실제 환경에 맞게 내용을 수정한 뒤 사용하세요.

예시:

```bash
cd /var/www/html/anime/inc
mv db.php.inc db.php
mv auth.php.inc auth.php
mv functions.php.inc functions.php
```

이후 `db.php`의 데이터베이스 접속 정보와 `auth.php`의 관리자 계정 정보를 실제 값으로 변경합니다.

## 주요 기능

### 애니 추가

1. 홈에서 "애니 추가" 모달을 열고 제목/설명/커버 이미지/시즌 ID 입력
2. `api/add_anime.php`에서 이미지 검증 후 `covers/`에 저장
3. `animes` 테이블에 INSERT

### 에피소드 추가

에피소드 원본은 세 가지 방식 중 하나로 지정할 수 있습니다.

#### 1. 스트리밍 다운로드 (Crunchyroll / Hidive)

1. 애니 상세 페이지에서 에피소드 번호 입력
2. `api/add_episode.php`에서 `animes.season_id`와 `is_hidive`를 조회
3. `jobs` 테이블에 `pending` 상태로 INSERT
4. 백그라운드로 `php worker/convert.php {job_id}` 실행
5. 다운로드 → 복호화 → 자막 처리 → MP4 변환 → `animes/{anime_id}/{ep}.mp4` 저장
6. `episodes` 테이블 UPSERT

#### 2. 직접 업로드

에피소드 추가 모달에서 "원본 영상 파일"을 선택하면, 업로드된 파일을 기반으로 변환합니다.

#### 3. 서버 파일 선택 (Transmission)

에피소드 추가 모달에서 **"서버 파일 선택"** 버튼을 누륾면, `/var/lib/transmission-daemon/downloads` 아래의 비디오 파일(MKV/MP4/MOV/AVI/WebM) 목록이 표시됩니다. 변환할 파일을 클릭하면 시즌 ID 없이도 백그라운드에서 MP4로 변환됩니다.

> 경로는 `api/list_server_files.php`의 `$root` 상수로 고정되어 있으며, 필요 시 해당 파일에서 변경할 수 있습니다.

### 시청

- `watch.php?aid={aid}&ep={ep}`에서 Video.js로 MP4 재생
- 자막은 다운로드 단계에서 영상에 burn-in 되므로 별도 플레이어 자막 처리는 필요 없음

## 보안 주의사항

- `inc/auth.php`와 `inc/db.php`에는 민감 정보가 하드코딩되어 있습니다. 운영 환경에서는 환경 변수나 별도 비밀 관리 도구로 분리하세요.
- 접근 인증번호와 쿠키 서명용 비밀키는 DB의 `settings` 테이블에 저장됩니다. 이 프로젝트가 오픈소스이므로 이러한 값을 소스 코드에 하드코딩하지 않도록 주의하세요.
- `downloader/`, `inc/`, `logs/`, `worker/`, `sql/` 디렉터리는 `.apache/anihy.conf`를 통해 웹에서 직접 접근할 수 없습니다.
- Apache의 Rewrite 규칙은 쿠키 존재 여부만 검사하며, 실제 서명 검증은 PHP에서 수행합니다. 강력한 보호가 필요하다면 추가적으로 `mod_session`이나 외부 인증 서비스를 고려하세요.
- 접근 인증 쿠키는 `HttpOnly`, `Secure`(HTTPS 환경), `SameSite=Lax`, 10년 만료로 설정됩니다. 외부 사이트에서의 직접 링크 클릭 시에도 쿠키가 전달되도록 `Lax`를 사용합니다.
- `api/search.php`와 `worker/convert.php`에서 `shell_exec()`를 사용합니다. 입력값은 `escapeshellarg()`로 처리하고 있지만, 추가적인 화이트리스트 검증을 권장합니다.
- 파일 업로드는 확장자만 검증합니다. 필요 시 MIME/type 검사를 추가하세요.
- 다운로더를 사용할 때는 Crunchyroll/Hidive 이용약관 및 관련 법규를 준수하세요.

## 라이선스

이 프로젝트는 개인적인 학습 및 비상업적 용도로만 사용하세요. 다운로드한 콘텐츠의 재배포는 금지됩니다.
