# 체로프 제작프로그램 · 제작실행기 v1

## 현재 실제로 하는 일

승인 HTML을 불변 템플릿으로 등록하고 이미지·움짤·폰트와 문구 슬롯을 별도 원본 파일과 작은 입력 JSON에 저장합니다. 서버는 1분마다 대기 요청을 확인하고 상품 증빙, 필수 슬롯, 등록 템플릿의 SHA-256을 검사한 뒤 HTML과 원본 이미지·폰트를 포함한 ZIP 초안을 제작합니다. 결과는 비공개 Storage, 진행 기록은 production_jobs/events, 대시보드 상태는 cherop_production_summary, 알림은 cherop_main.notices에 저장합니다. 브라우저/채팅 실행 상태와 무관합니다.

자동화 대상은 **등록 완료된 입력 자료로 템플릿 조립**입니다. 자연어 지시만으로 공식몰 탐색·제품 판단·AI 이미지 생성·시각검수·카카오 업로드까지 수행하는 자율 에이전트는 아닙니다. 그 작업은 디자인/MD 담당이 입력 자료로 준비해야 합니다. 다른 제품의 레이아웃/옵션 수가 다르면 해당 구조의 승인 템플릿을 별도 등록해야 하며 K01의 다섯 옵션을 복사하면 안 됩니다.

## 위치와 연결

- 워크스페이스: https://cherop-koko.github.io/cheropworkspace/#ai-team/production
- Supabase project: pmgntojnfglppjtypwzq
- Edge Function: production-engine
- 비공개 Storage bucket: cherop-production
- cron: cherop-production-worker (매분, 대기/만료 작업이 있을 때만 호출)
- 승인 K01 원본: libfile_c247487631708191af4293455120bf1e (보존)
- 업무 인계: app_state.cherop_kakao_detail_handoff_20261030
- 담당 목록: app_state.cherop_ai_role_assignments
- 코드: production-engine/{renderer.mjs,index.ts,schema.sql,runtime.sql}

## 새 채팅 인계 명령

> cherop-koko/cheropworkspace의 production-engine/README.md와 Supabase의 cherop_kakao_detail_handoff_20261030, production_jobs를 먼저 읽으세요. 해당 K번호와 request_key의 기존 실행/결과를 확인하고, 승인된 상품 구성·원본·템플릿을 대조하세요. 자료가 준비된 작업만 입력 JSON을 등록하여 제작실에 제출하세요. 중복 실행, 다른 채팅 업무 덮어쓰기, 자동 판매게시를 하지 마세요. 자료가 없는 항목은 필요한 자료와 상태를 남기고 독립적으로 가능한 작업을 진행하세요. 결과 파일·시각검수·작업 상태를 저장해 주세요.

## 등록과 실행 (연결 도구를 사용하는 담당자)

1. `production_jobs`에서 같은 상품과 요청 확인. 재시도/새 버전에는 명시적인 새 request_key를 사용합니다.
2. 공식몰과 인계서에서 SKU·옵션·실측·재고·포장·모델인증을 대조. 파일 속 `evidence`의 true는 실제 검수 뒤에만 작성. 입력 값의 선언은 외부기관 인증을 자동 검증한 결과가 아닙니다.
3. 승인 HTML을 `python production-engine/prepare_template.py APPROVED.html OUTPUT.json K01`로 슬롯화하고 옆에 원본 assets 폴더를 만듭니다. JSON과 원본 모두 inputs/에 업로드해야 합니다. evidence는 기본 false이므로 실제 확인 후 기록해야 합니다. 이 명령은 **승인본 재현용**입니다. 다른 상품에서는 이미지/문구/증빙을 전부 검토하여 교체해야 합니다. 새 틀은 SHA-256을 production_templates에 등록합니다. 원본 파일을 덮어쓰지 않습니다.
4. `select production_invoke('{"action":"prepare-upload","path":"inputs/고유영문파일명.json"}');` 반환 request id를 `net._http_response`에서 조회. 반환된 signedUrl에 JSON을 PUT합니다. 업로드 URL은 2시간 단기 자격증명입니다. 공개 로그/공지에 남기지 않습니다.
5. `insert into production_jobs(request_key,title,product_key,input_path) values (...) returning id;` 로 제출. 권한 있는 Supabase 연결 도구 또는 API만 등록 가능. 일반 브라우저 anon 쓰기는 불가합니다.
6. 서버가 매분 실행. 작업 상태 조회. `review`는 자동 검사 통과/초안 생성 완료이며 최종 승인 아님.
7. 결과: `production_invoke`에 `{"action":"download","id":"UUID"}`를 전달하고 응답 signedUrl로 다운로드. 링크는 10분 만료, **다운로드한 ZIP은 압축을 풀고 index.html을 열면 됩니다. 원본 이미지/폰트 파일이 함께 들어 있어 만료되지 않습니다**. 사용자에게 전달하는 파일은 영구 보관함에 저장합니다.
8. 실제 모바일 시각검수와 상품 대조 후 report에 검수 결과를 기록하고 approved로 전환합니다. 카카오 판매페이지에 게시하지 않습니다.

## 기본틀 필수 기준

- 모바일 전용 최대 430px, PC도 동일. 원본 폰트·여백·줄바꿈 보존.
- 사진/GIF 3:4. 여백을 새로 넣지 않고 피사체에 맞춰 크롭. 얼굴·귀·발 잘림은 실제 화면 검수.
- 원단·색상·얼굴·비율·공식 로고 보존. 실물과 다른 생성 이미지 금지.
- 모먼트 실사 크게 배치, 움짤만으로 채우지 않음. 디테일은 2×2, 각 칸 3:4, 캡션 없음.
- 삭제 지시한 문구·'곁에 두고 싶은 두 가지 모습' 섹션 복구 금지.
- 더스트백 문구, 세로 두 행 서비스 안내, 번호별 옵션 줄바꿈, 핸드메이드 안내는 상품에 실제 해당할 때만 사용.
- KC 번호/0세/신생아 문구는 모델별 증빙. K01 인증번호를 다른 상품에 복사하지 않음. 자석 키링에 신생아 문구 금지.
- 브랜드 로고, 서울 팝업·대구 외벽 두 사진, 두 줄 소개, HTML 텍스트 문의 버튼 유지.
- K01 코코·모리 판매 품절 유지. 이 시스템은 재고·판매가격을 변경하지 않음.

## 상태·복구·알림

queued → working → review / blocked / failed. 수동 취소는 cancelled. 최종 사람/담당자 검수는 approved.
원자적 claim과 임대 토큰으로 동시 중복 실행을 방지합니다. 비정상 종료 시 5분 임대 만료 후 최대 3회 재시도. 입력 오류/실행 오류는 사유를 기록하여 무한 재실행하지 않습니다. 취소된 작업의 늦은 결과는 반영하지 않습니다.
전체 SQL 기능은 service_role/관리 연결에서만 실행 가능합니다. 서버 토큰은 Vault에 있고 브라우저에 노출하지 않습니다. 기존 workspace-auth에 연결된 실계정이 생기면 API에서 검증하며, 현재 UI에는 보안 계정 준비 전 등록/다운로드 버튼을 노출하지 않습니다.
공지와 제작실은 요청 완료/확인 필요 상태를 보여줍니다. 휴대폰 푸시/이메일/카카오 메시지 발송은 미연결입니다.
예상시간은 충분한 비교 가능한 실행 이력이 쌓이기 전 표시하지 않습니다. 자료 준비·시각검수 시간까지 임의 추정하지 않습니다.

## 비용과 범위

v1은 외부 생성 AI API를 호출하지 않습니다. 기존 Supabase 함수/DB/저장공간 사용량은 증가합니다. 새 유료 플랜, 자동충전, 유료 AI 모델은 설정하지 않았습니다. K01 원본 약 36MB + 결과 약 36MB이므로 저장 용량은 별도 관리가 필요합니다. 이미지 생성/영상 편집 실행기는 다음 단계의 별도 연결이며 현재 완료로 표시하면 안 됩니다.

## 검증

`node --test tests/production-engine/renderer.test.mjs`.
승인 K01 본문·이미지·폰트 보존 재현, 실서버 cron→job→private ZIP→notice 종단 시험. 기존 승인본/K17 등 병행 제작 자료는 수정하지 않습니다.

## 화면 변경 필수 기준
화면 작업 전 WORKSPACE_DESIGN_RULES.md를 읽으세요. 제작실은 AI 조직도 안의 탭이며, 기존 공통 디자인을 재사용합니다. 새 시각 테마를 추가하지 마세요. 미리보기는 자체 포함 HTML을 별도 보관하고 app_state.cherop_production_previews의 jobs[작업UUID]에 previewURL/downloadURL을 기록합니다. ZIP만으로 미리보기가 가능하다고 안내하지 않습니다.
