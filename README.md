# Akagi Custom

공식 Akagi v3 레포지토리 기반의 개인 커스텀 빌드 및 패치 저장소입니다.

- **공식 원본 레포지토리 (`upstream`)**: [https://github.com/shinkuan/Akagi](https://github.com/shinkuan/Akagi)
- **커스텀 프라이빗 레포지토리 (`origin`)**: [https://github.com/14EE4/Akagi-custom](https://github.com/14EE4/Akagi-custom)

---

## 1. 적용된 커스텀 수정 사항

공식 Akagi v3의 기능을 대폭 확장하여 저사양/노트북 환경 최적화, 자동 연속 대국(Auto Queue), 실시간 디버거 HUD, AI 추천 확률 표시, 네트워크 단절 복구 및 서버 선택 기능 등이 적용되어 있습니다.

### ⚡ 1. Mortal 봇 안정성 및 추론 속도 최적화 (콜드스타트 해결)
1. **백그라운드 사전 워밍업 (`spawn_bot_prewarm`)**
   - 파일: `src/bot/supervisor.rs`, `src/ipc/commands.rs`
   - 아카기 실행 시 및 UI에서 봇 활성화 시 로비에서 미리 `bot.py 0`에 더미 `start_game` + `end_game`을 보내 Python, PyTorch DLL, `libriichi`, `mortal.pth`를 Windows RAM 캐시에 적재합니다.
2. **Mortal 모델 로드 직후 더미 1회 추론 워밍업**
   - 파일: `mjai_bot/mortal/model.py` (`_build_engine`)
   - `MortalEngine` 생성 직후 더미 입력으로 1회 추론을 미리 수행하여 PyTorch 초기 연산 커널 초기화를 스폰 단계에서 끝냅니다.
3. **콜드 스타트 타임아웃(`30초`) 분리 및 일반 턴 타임아웃(`15초`) 확대**
   - 파일: `src/bot/runner.rs` (`SubprocessBot`)
   - 스폰 직후 첫 `react()` 호출에는 최대 `30초`(`DEFAULT_FIRST_REACT_TIMEOUT_MS`)를 부여하고, 이후 일반 턴에는 `15초`(`DEFAULT_REACT_TIMEOUT_MS`)를 부여하여 노트북 CPU에서도 단일 추론 지연으로 봇이 종료되지 않도록 합니다.
4. **대국 중 `react()` 오류/타임아웃 발생 시 자동 재스폰 및 현재 국 리플레이 복구**
   - 파일: `src/bot/manager.rs` (`BotManager::recover_runner_after_error`)
   - 대국 도중 타임아웃/오류가 발생해도 그 판 전체에서 봇을 포기하지 않고 즉시 재스폰한 뒤, 보관된 `start_game` 및 현재 국 이벤트(`kyoku_events`)를 재주입하여 다음 턴부터 자동 복구합니다.
5. **배치/리플레이 처리 시 중간 이벤트 추론 생략 (`can_act=False`)**
   - 파일: `mjai_bot/mortal/bot.py` (`Bot.react`)
   - 여러 이벤트가 한 배치(`events`)로 전달될 때(재스폰 리플레이 시 100+ 이벤트 또는 리치 선언 에코 포함 배치), 마지막 이벤트(`idx == last_idx`)에서만 신경망 추론을 수행하고 이전 이벤트들은 `can_act=False`로 상태만 갱신하여 리플레이 지연을 `30초+` → `수 ms`로 단축합니다.
6. **유일 합법수(리치 후 강제 쯔모기리 등) Fast-Path 및 CPU 스레드 제한**
   - 파일: `mjai_bot/mortal/model.py` (`MortalEngine._react_batch`, `_build_engine`)
   - 가능한 행동(`masks[0]`)이 단 1개뿐인 경우 40블록 ResNet을 실행하지 않고 즉시(`~0.4ms`) 확률 `100%`로 해당 행동을 반환합니다.
   - CPU 모드에서 PyTorch OpenMP 스레드 수를 최대 4개로 제한하여 Chromium(WebGL) 프로세스와의 CPU 코어 경합을 방지합니다.

### 🔄 2. 네트워크 단절 복구 및 봇 수동 재동기화 (Resync Bot)
7. **게임 일시 단절/재접속 시 원클릭 봇 깨우기 (`resync_bot`)**
   - 파일: `src/bot/manager.rs`, `src/ipc/commands.rs`, `frontend/src/routes/PlayClient.tsx`
   - 모바일 등 다른 기기에서 잠깐 접속하거나 네트워크 순단으로 클라이언트 연결이 끊겼을 때, 아카기를 재시작하지 않고 게임 탭의 **'봇 깨우기'** 버튼을 누르면 즉시 봇을 재스폰하고 현재 국 이벤트들을 재주입하여 대국을 계속 이어갑니다.

### 🎮 3. 작혼 클라이언트 편의 기능 (서버 선택 & 중복 로그인 방지)
8. **게임/플레이 탭 상단 헤더 인라인 서버(지역) 선택 UI & 자동 실행 방지**
   - 파일: `frontend/src/components/ServerSelector.tsx`, `frontend/src/routes/PlayClient.tsx`, `src/config/capture.rs`, `src/lib.rs`
   - **화면 가림 없는 인라인 서버 셀렉터**: 임베디드 브라우저 화면에 팝업이 가려지지 않도록 상단 헤더(`h-11`)에 `[🌐 서버: ] [일섭 (JP)] [한섭 (KR)] [글섭 (EN)] [중섭 (CN)]` 인라인 세그먼트 버튼을 배치하여 언제든 현재 서버를 확인하고 원클릭으로 변경/재시작할 수 있습니다.
   - **서버 전환 및 재시작 시 중복 실행 방지 & 비동기 상태 동기화**: 브라우저 창 감지(`status.browser_found`)까지 포함한 종합 활성 판정(`isBrowserActive`)을 도입하여 재시작 도중 `[작혼 실행]` 버튼이 중복 노출되거나 재시작 루프에 빠지는 버그를 원천 차단했습니다. 서버 전환 시 상단에 `[서버 전환 및 재시작 중… (스피너)]`가 표시되며 헤더 컨트롤이 안전하게 일괄 잠금됩니다.
   - **브라우저 실행 전 대기 화면 & 원클릭 시작**: 브라우저 미실행 시 중앙 카드에서 서버를 먼저 선택한 후 `[▶ 선택한 서버로 작혼 브라우저 실행]` 버튼으로 원하는 서버로 정확하게 실행할 수 있습니다.
   - **아카기 시작 시 브라우저 자동 실행 방지 (`auto_launch = false`)**: 아카기를 켜더라도 작혼 브라우저가 즉시 자동 실행되지 않도록 기본 설정하여, 모바일/타 기기에서 플레이 중일 때 발생하는 원치 않는 중복 로그인 및 강제 로그아웃을 완벽하게 방지합니다.
9. **독립 브라우저 창 분리 / 아카기 탭 내장(임베드) 토글**
   - 파일: `src/ipc/embed.rs`, `frontend/src/routes/PlayClient.tsx`
   - 아카기 메인 창 안에 작혼 브라우저 화면을 직접 고정하여 일체형으로 플레이하거나, 언제든지 외부 독립 창으로 분리할 수 있습니다. 탭 이동이나 창 최소화 시에도 백그라운드 렌더링과 오토플레이가 멈추지 않습니다.

### 🔁 4. 대국 종료 후 자동 연속 매칭 (Auto Queue - 패킷 기반 실시간 로비 복귀)
10. **지능형 자동 다음 대국 진행 (Auto Queue & 정산 판정 근본 해결)**
   - 파일: `src/autoplay/auto_queue.rs`, `src/config/autoplay.rs`, `src/bridge/majsoul/mod.rs`, `frontend/src/routes/PlayClient.tsx`
   - **결정적 메인 로비 패킷 엄격 판정**: 대국 종료 후 고정 횟수 클릭 대신 실제 메인 로비 진입 패킷(`.lq.Lobby.loginBeat`, `.lq.Lobby.fetchAccountActivityData`, `.lq.Lobby.leaveRoom`, `.lq.Lobby.startUnifiedMatch`)이 수신될 때까지 확인을 클릭하고, 감지 즉시 정산 상태(`is_settling = false`)로 전환하여 딜레이 없이 즉시 다음 단위전 매칭을 진행합니다.
   - **정산 중 백그라운드 단순 조회 패킷 오감지 원천 차단**: `.lq.Lobby.fetchAccountInfo`, `.lq.Lobby.logReport` 등 결과 화면 중 송수신되는 무관한 패킷으로 인한 조기 오감지를 완벽히 차단했습니다.
   - **실시간 패킷 감지 위젯 연동**: 화면 우측 사이드바의 패킷 감지 위젯에 메인 로비(Lobby), 대국 진행 중(InGame), 정산 중(GameEnd) 상태가 실시간으로 동기화됩니다.
   - **단위전 자동 진입 네비게이션**: 로비 진입 확정 후 `[단위전 (11.5, 2.8)] → [은탁 (11.5, 4.6)] → [4인 반장전 (11.5, 4.6)]`으로 안전하게 순차 클릭합니다.
   - **인간적인 딜레이 & 최대 대국 수 제한**: 휴식 카운트다운(초) 및 목표 판수(`max_matches`, 0=무제한) 도달 시 자동 종료.

### 🎯 5. 실시간 디버거 HUD & 우측 사이드바 및 UI 최적화
11. **우측 사이드바 AI 추천(Top 3) 카드 오버레이 및 상단 헤더 정리**
   - 파일: `frontend/src/routes/PlayClient.tsx`
   - **사이드바 내장 AI 추천 오버레이**: `BotShowList`와 마작패 타일(`Mahgen`) 렌더러를 우측 사이드바 상단에 내장하여 1순위(최선책), 2·3순위(차선책)의 실제 마작패 타일 그래픽, 행동(타패, 리치, 퐁 등), 신경망 확률(%) 및 기댓값(EV)을 게임 화면 가림 없이 선명하게 표시합니다.
   - **사이드바 [현재 화면 상태 감지] 버튼 & 라이브 뱃지**: 사이드바에 화면 상태 감지 버튼을 배치하고, 클릭 시 비동기 로딩 스피너와 실시간 판정 상태를 즉각 시각적 뱃지로 안내합니다.
12. **토스트 알림 네이티브 창 가림 방지 (Airspace Occlusion 해결)**
   - 파일: `frontend/src/components/ui/sonner.tsx`
   - 우측 사이드바(18rem) 내부로 Sonner 토스트 너비를 `16.5rem`(약 264px) 및 우측 여백 `0.75rem`(12px)으로 제한하여, 좌측 작혼 브라우저 화면(Win32 네이티브 자식 창)과의 겹침 및 잘림 현상을 완벽히 해결했습니다.
13. **화면 가림 방지 플로팅 디버그 HUD & 십자선 마커**
   - 파일: `src/autoplay/cdp_input.rs`, `frontend/src/routes/PlayClient.tsx`
   - 작혼 게임 화면을 가리지 않도록 우상단/좌상단 이동 및 1줄 컴팩트(최소화) 모드를 지원하는 플로팅 디버그 HUD 제공.
   - 클릭 지점에 2.3초간 유지되는 선명한 붉은색 Crosshair(십자 조준선) 마커 및 픽셀 로그 출력.
   - 16:9 정규화 좌표(확인 X:13.9 Y:8.2, 한번더 X:12.0 Y:8.2, 팝업 네 X:6.9 Y:6.5) 및 단계별 밀리초 단위 딜레이 실시간 미세조정.

---

## 2. 노트북 동기화 방법 (main 브랜치)

빌드 완료된 `akagi.exe`와 `mjai_bot/mortal` 스크립트(Windows용 `libriichi` `.pyd` 포함)가 레포지토리에 포함되어 있으므로, 노트북에서는 별도 빌드 없이 `git pull`만으로 동기화할 수 있습니다 (`mortal.pth` 가중치 파일만 `mjai_bot/mortal/mortal.pth`에 위치하면 됩니다).

### 최초 1회 설정 (노트북 아카기 폴더)
```powershell
# 기존에 .git이 없는 일반 폴더인 경우:
git init
git remote add origin https://github.com/14EE4/Akagi-custom.git

# 이미 .git이 있는 폴더인 경우:
git remote set-url origin https://github.com/14EE4/Akagi-custom.git

# main 브랜치 받아오기 (mortal.pth, configs/, chrome-profile/ 등은 유지됨):
git fetch origin
git checkout -f -B main origin/main
```

### 최초 1회: Python 런타임(`runtime/`) 준비

`runtime/python`, `runtime/uv`(번들 Python + uv)는 `.gitignore`(`runtime/*`)로 제외되어 있어 `git clone` / `git pull`로는 받아지지 않습니다. 비어 있으면 아카기 **Bots 탭의 Python 환경 설치가 실패**합니다 (번들 런타임이 없으면 시스템 PATH의 `python3`/`uv`를 찾는데, 없으면 설치 불가).

아래 둘 중 하나로 `akagi.exe`와 같은 폴더의 `runtime/`을 채워 주세요.

```powershell
# 방법 A: 이미 런타임이 있는 PC의 runtime 폴더를 통째로 복사
#   → <아카기 폴더>\runtime\python\x86_64-pc-windows-msvc\python.exe
#   → <아카기 폴더>\runtime\uv\x86_64-pc-windows-msvc\uv.exe  가 있어야 함

# 방법 B: 스크립트로 내려받기 (Git Bash 또는 WSL 필요, curl/tar/unzip 사용)
bash scripts/fetch-runtime.sh x86_64-pc-windows-msvc
```

### 이후 업데이트 시
```powershell
Stop-Process -Name "akagi" -Force -ErrorAction SilentlyContinue
git pull
```

---

## 3. 데스크톱에서 공식(`upstream/v3`) 업데이트 병합 및 빌드 방법

> **주의**: 앱 내 UI의 자동 업데이트 버튼을 누르면 공식 순정 `akagi.exe`가 덮어씌워져 커스텀 패치가 사라집니다. 업데이트는 반드시 아래 Git 병합 및 로컬 빌드로 진행하세요.

```powershell
git checkout main
git pull upstream v3
npm --prefix frontend run build
$env:PROTOC = "C:\Users\pyeon\.gemini\antigravity-cli\brain\e09dcb65-b75c-45dc-9ccd-1b8d0157081b\scratch\protoc\bin\protoc.exe"
Stop-Process -Name "akagi" -Force -ErrorAction SilentlyContinue
cargo build --release --features custom-protocol
Copy-Item -Path "target\release\akagi.exe" -Destination "akagi.exe" -Force
git add -A
git commit -m "chore: merge upstream/v3 and rebuild akagi.exe"
git push origin main
```
