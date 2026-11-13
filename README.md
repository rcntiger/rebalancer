# 리밸런서

다계좌 주식 포트폴리오 리밸런싱 웹앱 (KIS OpenAPI 시세 연동)

- 실행: https://rcntiger.github.io/rebalancer/
- 시세 조회에는 **내 PC에서 실행 중인 KIS 프록시**(`kis_proxy.exe`, localhost:5000)가 필요합니다.
- 계좌·API 키는 브라우저 저장소(localStorage)에만 저장되며, 이 저장소에는 개인 데이터가 없습니다.

## 처음 설정
1. PC에서 `register_protocol.bat` 실행 (최초 1회) → 앱의 **▶ 프록시 실행** 버튼 사용 가능
2. 앱 접속 후 크롬이 "로컬 네트워크 접근"을 물으면 **허용**
3. 설정에서 KIS AppKey/AppSecret 입력 → PIN 설정
4. 기존 파일 버전에서 쓰던 데이터는 **내보내기 → 가져오기**로 옮김

앱과 프록시 버전이 다르면 하단에 경고가 표시됩니다.
