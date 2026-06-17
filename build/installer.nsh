; 신규 버전 설치 시 모든 이전 버전을 제거하고 설치한다.
; (사용자 단위 HKCU + 시스템 단위 HKLM 모두 정리 — 예전 관리자 설치본까지 제거)

!macro customInit
  ; --- 사용자 단위(HKCU) 이전 설치 제거 ---
  ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ReadRegStr $R1 HKCU "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $R0 != ""
    ${If} $R1 != ""
      ExecWait '"$R0" /S _?=$R1'
      Delete "$R0"
      RMDir "$R1"
    ${Else}
      ExecWait '"$R0" /S'
    ${EndIf}
  ${EndIf}

  ; --- 시스템 단위(HKLM) 이전 설치 제거 ---
  ReadRegStr $R0 HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ReadRegStr $R1 HKLM "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $R0 != ""
    ${If} $R1 != ""
      ExecWait '"$R0" /S _?=$R1'
      Delete "$R0"
      RMDir "$R1"
    ${Else}
      ExecWait '"$R0" /S'
    ${EndIf}
  ${EndIf}
!macroend

; 설치/업데이트 시 바탕화면 바로가기를 '실제(리디렉션된) 바탕화면'에 항상 생성
; (OneDrive 백업 등으로 바탕화면이 이동된 환경 대응)
!macro customInstall
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders" "Desktop"
  ${If} $0 != ""
    CreateShortcut "$0\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${EndIf}
!macroend
