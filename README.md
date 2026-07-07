# AniHy

Crunchyroll에서 애니메이션을 다운로드하고 자막과 합성하여 웹에서 스트리밍할 수 있는 PHP 기반 개인용 애니 스트리밍 사이트입니다.

## 개요

- **서비스 언어**: 한국어
- **진입점**: `/anime/` (Apache 서브 디렉터리로 동작)
- 관리자 로그인 후 애니메이션과 에피소드를 등록·수정·삭제할 수 있습니다.
- 에피소드 등록 시 Crunchyroll 시즌 ID를 입력하면 백그라운드에서 다운로드 → 복호화 → 자막 처리 → MP4 변환이 진행됩니다.

## 기술 스택

| 구성 요소 | 사용 기술 |
|-----------|-----------|
| 백엔드 | PHP 8.4 |
| 데이터베이스 | MariaDB / MySQL |
| 웹 서버 | Apache |
| 프론트엔드 | Vanilla JS, CSS3, Video.js 8.10.0 |
| 미디어 처리 | ffmpeg 6.x, Bento4(mp4decrypt), Intel VA-API |
| 다운로더 | [multi-downloader-nx](https://github.com/anidl/multi-downloader-nx) 5.7.4 |

## 디렉터리 구조

```
/var/www/html/anime/
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

1. 애니 상세 페이지에서 에피소드 번호 입력
2. `api/add_episode.php`에서 `animes.season_id`를 조회
3. `jobs` 테이블에 `pending` 상태로 INSERT
4. 백그라운드로 `php worker/convert.php {job_id}` 실행
5. 다운로드 → 복호화 → 자막 처리 → MP4 변환 → `animes/{anime_id}/{ep}.mp4` 저장
6. `episodes` 테이블 UPSERT

### 시청

- `watch.php?aid={aid}&ep={ep}`에서 Video.js로 MP4 재생
- 자막은 다운로드 단계에서 영상에 burn-in 되므로 별도 플레이어 자막 처리는 필요 없음

## 보안 주의사항

- `inc/auth.php`와 `inc/db.php`에는 민감 정보가 하드코딩되어 있습니다. 운영 환경에서는 환경 변수나 별도 비밀 관리 도구로 분리하세요.
- `api/search.php`와 `worker/convert.php`에서 `shell_exec()`를 사용합니다. 입력값은 `escapeshellarg()`로 처리하고 있지만, 추가적인 화이트리스트 검증을 권장합니다.
- 파일 업로드는 확장자만 검증합니다. 필요 시 MIME/type 검사를 추가하세요.
- 다운로더를 사용할 때는 Crunchyroll 이용약관 및 관련 법규를 준수하세요.

## 라이선스

이 프로젝트는 개인적인 학습 및 비상업적 용도로만 사용하세요. 다운로드한 콘텐츠의 재배포는 금지됩니다.
