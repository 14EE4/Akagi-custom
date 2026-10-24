# Akagi 로컬 워크스페이스 가이드 및 커스텀 패치 메모 (`AGENTS.md`)

이 문서는 Antigravity 에이전트가 세션을 다시 시작할 때마다 자동으로 읽어들여 컨텍스트를 유지하기 위한 프로젝트 규칙 및 작업 메모입니다.

---

## 1. 로컬 빌드 및 실행 파일(`akagi.exe`) 교체 규칙 (필수)

1. **`--features custom-protocol` 옵션 필수**
   - 단순 `cargo build --release`로만 빌드하면 Tauri가 내장 프론트엔드(`frontend/dist`) 대신 개발 서버(`http://localhost:1420`)로 접속을 시도하여 실행 시 **`localhost에서 연결을 거부했습니다`** 오류가 발생합니다.
   - 반드시 아래와 같이 `--features custom-protocol`을 포함하여 빌드하고 루트의 `akagi.exe`에 덮어써야 합니다:
     ```powershell
     Stop-Process -Name "akagi" -Force -ErrorAction SilentlyContinue
     cargo build --release --features custom-protocol
     Copy-Item -Path "target\release\akagi.exe" -Destination "akagi.exe" -Force
     ```
2. **`build.rs` 및 `src/bridge/majsoul/proto/liqi.proto` 주의사항**
   - 현재 PC 환경의 PATH에 `protoc.exe`가 등록되어 있지 않으며, `target/release/build/`에 이미 컴파일된 protobuf 산출물(`lq.rs`, `liqi_desc.bin`)이 캐시되어 있습니다.
   - 따라서 `cargo clean`을 실행하거나 `build.rs` / `liqi.proto`의 타임스탬프를 건드리지 말고 증분 빌드(`cargo build --release --features custom-protocol`)를 유지해야 합니다.

---

## 2. 적용된 로컬 커스텀 패치 내역 (Mortal 첫 판 로딩 시간초과 해결)

작혼 친선전/대국 첫 판 시작 시 Python/PyTorch/Mortal 가중치(`mortal.pth`) 콜드 스타트(Cold Start) 로딩이 5초 타임아웃을 초과하여 첫 판 내내 봇이 죽어버리던 문제를 해결하기 위해 다음 4가지 수정이 적용되어 있습니다.

1. **아카기 실행 및 봇 활성화 시 백그라운드 사전 워밍업 (`spawn_bot_prewarm`)**
   - 파일: `src/bot/supervisor.rs`, `src/ipc/commands.rs`
   - 아카기 시작 시(`run_bot_manager`) 및 UI에서 봇 활성화 시(`set_active_bot`), 대국 시작(`start_game`)을 기다리지 않고 백그라운드에서 미리 `bot.py 0`에 더미 `start_game` + `end_game`을 보내 Python, PyTorch DLL, `libriichi`, `mortal.pth`를 Windows RAM 파일 캐시(Standby List)에 적재합니다.
2. **Mortal 모델 로드 직후 더미 1회 추론 워밍업**
   - 파일: `mjai_bot/mortal/model.py` (`_build_engine`)
   - `MortalEngine` 생성 직후 더미 텐서(`obs`, `masks`)로 `_react_batch`를 1회 실행하여 PyTorch 초기 연산 커널 초기화를 프로세스 스폰 단계에서 미리 끝냅니다 (`eval_time_ns` 첫 턴 지연 `~540ms` → `~40ms`로 단축).
3. **서브프로세스 봇 첫 `react()` 콜드 스타트 타임아웃 분리 (`30초`) 및 일반 턴 타임아웃 여유 확보 (`15초`)**
   - 파일: `src/bot/runner.rs` (`SubprocessBot`)
   - `DEFAULT_FIRST_REACT_TIMEOUT_MS = 30_000` (30초)를 도입하여 스폰 직후 첫 번째 `react()` 호출에는 최대 30초를 기다리고, 첫 응답 성공 이후부터 일반 턴 타임아웃(`DEFAULT_REACT_TIMEOUT_MS = 15_000`, 15초)을 적용하여 저사양 노트북 CPU에서도 단일 추론 지연으로 봇이 죽지 않도록 합니다.
4. **대국 중 `react()` 오류/타임아웃 발생 시 자동 재스폰 및 현재 국 리플레이 복구**
   - 파일: `src/bot/manager.rs` (`BotManager::recover_runner_after_error`)
   - 대국 도중 `react()`가 실패하더라도 그 게임 전체에서 봇을 포기(`runner = None`)하지 않고, 즉시 봇을 재스폰한 뒤 보관해 둔 `game_start_event`(`start_game`)와 `kyoku_events`(`start_kyoku` 이후 현재 국 이벤트들)를 `pending` 큐에 재주입하여 다음 턴부터 즉시 복구합니다.
5. **배치/리플레이 처리 시 중간 이벤트 추론 생략 (`can_act=False`)**
   - 파일: `mjai_bot/mortal/bot.py` (`Bot.react`)
   - 여러 이벤트가 한 배치(`events`)로 전달될 때(특히 재스폰 리플레이 시 100+ 이벤트 또는 리치 선언 에코 포함 배치), 마지막 이벤트(`idx == last_idx`)에서만 신경망 추론을 수행하고 이전 이벤트들은 `self.model.react(event_json, can_act=False)`로 상태만 갱신하여 리플레이 지연을 `30초+` → `수 ms`로 단축합니다.
6. **유일 합법수(리치 후 강제 쯔모기리 등) 신경망 연산 생략 (Fast-Path) 및 CPU 스레드 제한**
   - 파일: `mjai_bot/mortal/model.py` (`MortalEngine._react_batch`, `_build_engine`)
   - 가능한 행동(`masks[0]`)이 단 1개뿐인 경우 40블록 ResNet을 실행하지 않고 즉시(`~0.4ms`) 확률 `1.0`으로 해당 행동을 반환합니다. 또한 CPU 모드에서 OpenMP 스레드 수를 최대 4개로 제한하여 Chromium WebGL 프로세스와의 CPU 경합을 방지합니다.

---

## 3. 브랜치 구조 및 원격 저장소 규칙 (원본 레포 보존)

- **공식 원본 레포(`upstream`, `shinkuan/Akagi`) 절대 건드리지 않기 (필수)**:
  - `upstream` 저장소(`shinkuan/Akagi`)에는 **이슈 생성(`gh issue create`), 브랜치 푸시(`git push upstream`), Pull Request(PR) 생성 등 어떠한 변경/등록 작업도 절대 수행하지 않습니다.**
  - 모든 이슈 등록, 코드 푸시, 기능 제안 및 작업 관리는 **오직 사용자 개인 포크 저장소인 `origin` (`14EE4/Akagi-custom`)에서만 수행**합니다.
  - `upstream`은 오직 공식 릴리스 및 최신 순정 코드를 읽어오기 위한 참조용(`git fetch upstream`, `git pull upstream v3`)으로만 사용합니다.
- **원격 저장소 및 브랜치 분리**:
  - `dev` 브랜치 (`origin/dev`): **모든 기능 개발, 수정 및 테스트 빌드가 이루어지는 기본 개발 브랜치**
  - `main` 브랜치 (`origin/main`): 테스트 및 실전 검증이 완료된 안정된 릴리스 브랜치
  - `v3` 브랜치 (`upstream/v3`): 공식 원본 순정 브랜치 (읽기 전용 참조)
- **앱 내 자동 업데이트(UI의 업데이트 버튼) 사용 주의**: GitHub Releases의 순정 `akagi.exe`를 내려받아 덮어쓰므로 위 커스텀 패치가 사라집니다.

---

## 4. 작업 진행 필수 표준 워크플로우 (순서 엄격 준수)

모든 작업(버그 수정, 신규 기능 추가, UI 개선 등)은 반드시 다음 4단계 순서를 엄격히 준수하여 진행합니다:

```
[1단계: 이슈 생성] ➔ [2단계: dev에서 브랜치 분기] ➔ [3단계: 작업 및 로컬 빌드] ➔ [4단계: 사용자 테스트 검증 후 PR]
```

1. **1단계: 이슈(Issue) 먼저 생성**:
   - 코드를 수정하기 전에 사용자 개인 포크 저장소(`14EE4/Akagi-custom`)에 배경, 문제점 및 구체적인 작업 계획을 담은 이슈를 먼저 등록합니다 (`gh issue create`).
2. **2단계: `dev` 브랜치에서 새 작업 브랜치 분기**:
   - 반드시 최신 `dev` 브랜치를 기준으로 새 피처 브랜치를 생성하여 이동합니다 (`git checkout -b feat/... dev`).
   - `main` 브랜치에서 직접 분기하거나 직접 커밋하지 않습니다.
3. **3단계: 코드 구현 및 로컬 빌드 검증**:
   - 코드 작업 후 반드시 `--features custom-protocol` 릴리즈 빌드 및 프론트엔드 빌드를 통과시키고 로컬 테스트를 진행합니다.
4. **4단계: 사용자 테스트 검증 후 PR 생성 및 머지**:
   - 코드를 임의로 `main`에 올리지 않습니다.
   - **사용자가 직접 실전 테스트와 검증을 완료하고 승인한 후**에 PR을 생성하여 `dev`에 머지합니다.
   - **`main` 브랜치는 사용자가 모든 테스트를 마치고 명시적으로 `main` 반영을 지시할 때만 머지**합니다.
