# AI 제작 실행기 v2 — 연결 전 / 실 API 미검증

이 폴더는 v1 파일 조립기와 별개의 실제 AI 호출 코드다. **코드 작성과 운영 가동은 다르다. 현재 자동제작 서비스가 가동됐다는 의미가 아니다.**

## 구현한 흐름

- 확정 상품명·옵션·규격·출처와 승인 슬롯 템플릿을 입력받는다.
- 공식몰 출처를 수집하고 등록된 상품별 원본 사진을 내려받는다.
- Responses API가 원본 사진과 사실을 보고 문구와 사진 배치를 결정한다.
- 프로그램이 고정 문구/안전성 주장/템플릿/이미지 주소를 검사한다.
- Chromium으로 360/390/430px 화면 전체를 분할 촬영한다.
- AI가 원본·승인틀·사실과 화면을 비교한다. 실패 시 수정 후 다시 검수하며 최대 3회 시도한다.
- 결과 HTML, 화면 캡처, 검수 기록, API 사용량을 비공개 Storage에 저장한다.
- 기존 제작실 기록에 작업번호와 상품명을 남긴다. 자체검수 통과도 review이며 사람이 승인한 approved로 바꾸지 않는다.

## 아직 구현/연결되지 않은 것

- 원본 사진 자동 발견·SKU 판정: 현재 상품별 assetCatalog가 필요하다.
- 새 이미지 생성/원단 보정, 영상→GIF 제작: 현재 원본 사진/움짤을 그대로 선택한다.
- 비공개 Sites로 결과를 자동 게시하는 연결: 미완료. report.previewPublished=false로 남긴다. HTML 다운로드를 모바일 미리보기라고 안내하지 않는다.
- 실제 API 자격증명과 모델 접근권한, 서버 종단 시험: 미확인.
- 따라서 전체 자율 자동제작 완료로 보고하면 안 된다.

## 연결 순서

1. GitHub repository Settings → Environments에서 `production-ai` 환경을 만든다.
2. 환경 Secrets: `CHEROP_OPENAI_API_KEY`, `CHEROP_SUPABASE_SERVICE_KEY`. 값을 채팅/커밋에 쓰지 않는다. 후자는 서버 전용 서비스키다.
3. 환경 Variables: 계정에서 실제 접근 가능한 이미지 입력·Structured Outputs 지원 모델 ID를 `CHEROP_TEXT_MODEL`에 지정한다.
4. `queue.sql`을 현재 함수 정의와 비교 후 적용한다. 기존 template 실행기와 ai 작업을 구분한다. 마이그레이션과 RLS 확인 전 활성화하지 않는다.
5. schemaVersion=2 입력 JSON을 비공개 `cherop-production/inputs/ai/`에 저장한다. 승인 템플릿은 SHA-256과 함께 고정하고, 옵션·사이즈·인증번호·포장조건은 lockedTextKeys로 잠근다.
6. production_jobs에 runner='ai', title='K번호 · 상품명 · 규격', product_key, input_path, 고유 request_key로 등록한다.
7. Repository Variable `CHEROP_AI_ENABLED=true`로 켜고 Actions → CHEROP AI production → Run workflow로 1건 시험한다. 이후 약 10분 간격으로 대기 작업 1건씩 실행한다. GitHub 스케줄 지연이 있을 수 있다.
8. 실제 결과·과금 사용량·실패 처리·취소·모바일 미리보기까지 확인한 뒤에만 운영 가동으로 안내한다. 현재 이 단계 미완료.

## 입력 형식

`test_worker.py`의 brief()는 구조 예시다(가짜 이미지 주소로 운영 제출 금지).
template.html에는 {{text:키}}와 {{asset:키}}를 사용한다. texts는 기존 승인 문구다. facts는 상품 사실, sources는 공식몰 상품 링크, assetCatalog는 id → {productKey,url,설명} 사전이다. 이미지 호스트는 cherop.com/www.cherop.com/cdn.imweb.me만 허용한다. 외부 리디렉션은 차단한다.

## 로컬 검증

`python -m unittest discover -s production-engine/ai-worker -p 'test_*.py' -v`

테스트는 mock 모델/이미지로 로직을 검증하며 실제 AI 품질·API 연결 성공을 증명하지 않는다.

## 운영 제한

작업당 3회 수정, 이미지 40개, 페이지 42000px 한도. 실패를 무한 반복하지 않는다. 모델 호출마다 최대 출력 8000토큰. 금액 상한은 제공자 프로젝트에서 별도 관리해야 한다. 이미지가 많은 긴 상세페이지는 검수 호출도 많아지므로 1건 실측 후 일괄 실행한다. 소비자 판매페이지와 재고는 수정하지 않는다.
