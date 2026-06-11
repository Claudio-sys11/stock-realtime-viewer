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
