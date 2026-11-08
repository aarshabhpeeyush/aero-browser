; Aeris setup. Installs Aeris just for you, with no admin needed: it copies the browser into a folder
; in your user account, adds shortcuts and an uninstaller, moves you over from Aero, then starts Aeris.
; (Firefox's own installer isn't used: it asks Windows for admin rights. Aeris registers itself as a
; browser when you choose to make it your default, which needs no admin either.)
; Built in the cloud by .github/workflows/aeris.yml:
;   makensis -DVERSION=1.0.0 -DNUMVER=1.0.0 -DAPPDIR=<unpacked Aeris folder> -DUBLOCK=<uBlock xpi>
;            -DICON=aeris.ico -DOUT=Aeris-Setup-1.0.0.exe aeris-setup.nsi
; Options:  /S        quietly (used by updates)
;           /RELAUNCH start Aeris afterwards (also "--force-run", which Aero's updater sends)

Unicode true
!include LogicLib.nsh
!include FileFunc.nsh

Name "Aeris"
Caption "Installing Aeris ${VERSION}"
OutFile "${OUT}"
Icon "${ICON}"
UninstallIcon "${ICON}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
AutoCloseWindow true
BrandingText "Aeris ${VERSION}"
VIProductVersion "${NUMVER}.0"
VIAddVersionKey "ProductName" "Aeris"
VIAddVersionKey "FileDescription" "Aeris setup"
VIAddVersionKey "FileVersion" "${NUMVER}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Aeris is built on Firefox by Mozilla (MPL 2.0)"

Page instfiles
UninstPage instfiles

!define AERO_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\3545b983-5cb7-5cf5-b0f3-649ad1553ff2"
!define AERIS_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\Aeris"

; Wait (up to a minute) for Aeris to finish closing, so its files can be replaced.
!macro WaitForAeris DIR
  StrCpy $1 0
  ${DoWhile} ${FileExists} "${DIR}\xul.dll"
    ClearErrors
    FileOpen $2 "${DIR}\xul.dll" a
    ${IfNot} ${Errors}
      FileClose $2
      ${Break}
    ${EndIf}
    IntOp $1 $1 + 1
    ${If} $1 > 60
      ${Break}
    ${EndIf}
    DetailPrint "Waiting for Aeris to close..."
    Sleep 1000
  ${Loop}
!macroend

Section
  ${GetParameters} $R0

  ; Install where Aeris already is, or in a folder just for you.
  ReadRegStr $0 HKCU "Software\Aeris" "InstallDir"
  ${If} $0 == ""
    StrCpy $0 "$LOCALAPPDATA\Programs\Aeris"
  ${EndIf}
  !insertmacro WaitForAeris "$0"

  ; An older Aeris goes first, so no old files are left behind. (Your profile, bookmarks and
  ; settings live elsewhere and aren't touched.)
  ${If} ${FileExists} "$0\aeris.exe"
    DetailPrint "Removing the old version..."
    RMDir /r "$0"
  ${EndIf}

  DetailPrint "Installing Aeris ${VERSION}..."
  SetOutPath "$0"
  File /r "${APPDIR}\*.*"
!ifdef UBLOCK
  ; uBlock Origin comes with Aeris (Firefox adds it to each new profile from here).
  SetOutPath "$0\distribution\extensions"
  File "/oname=uBlock0@raymondhill.net.xpi" "${UBLOCK}"
!endif
  SetOutPath "$0"
  ${IfNot} ${FileExists} "$0\aeris.exe"
    MessageBox MB_ICONSTOP "Aeris couldn't be installed. Please try again." /SD IDOK
    Abort
  ${EndIf}

  ; Shortcuts, and an entry in Windows' "Installed apps" to uninstall it
  CreateShortCut "$SMPROGRAMS\Aeris.lnk" "$0\aeris.exe"
  CreateShortCut "$DESKTOP\Aeris.lnk" "$0\aeris.exe"
  ; Aquaris: Aeris started with its own profile called Aquaris, which opens the Aquaris desktop
  CreateDirectory "$APPDATA\Aeris\Aquaris"
  CreateShortCut "$SMPROGRAMS\Aquaris.lnk" "$0\aeris.exe" '-profile "$APPDATA\Aeris\Aquaris"'
  WriteUninstaller "$0\Uninstall Aeris.exe"
  WriteRegStr HKCU "Software\Aeris" "InstallDir" "$0"
  WriteRegStr HKCU "Software\Aeris" "Version" "${VERSION}"
  WriteRegStr HKCU "${AERIS_UNINSTALL}" "DisplayName" "Aeris"
  WriteRegStr HKCU "${AERIS_UNINSTALL}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${AERIS_UNINSTALL}" "Publisher" "Aeris Project"
  WriteRegStr HKCU "${AERIS_UNINSTALL}" "DisplayIcon" "$0\aeris.exe"
  WriteRegStr HKCU "${AERIS_UNINSTALL}" "InstallLocation" "$0"
  WriteRegStr HKCU "${AERIS_UNINSTALL}" "UninstallString" '"$0\Uninstall Aeris.exe"'
  WriteRegStr HKCU "${AERIS_UNINSTALL}" "QuietUninstallString" '"$0\Uninstall Aeris.exe" /S'
  WriteRegDWORD HKCU "${AERIS_UNINSTALL}" "NoModify" 1
  WriteRegDWORD HKCU "${AERIS_UNINSTALL}" "NoRepair" 1
  ${GetSize} "$0" "/S=0K" $3 $4 $5
  WriteRegDWORD HKCU "${AERIS_UNINSTALL}" "EstimatedSize" $3

  ; Aero: Aeris brings your bookmarks, settings and passwords over on its first start (they stay
  ; in Aero's data folder, which Aero's uninstaller keeps), so the old browser itself can go.
  ReadRegStr $4 HKCU "${AERO_UNINSTALL}" "QuietUninstallString"
  ${If} $4 != ""
    DetailPrint "Removing Aero (your data stays for Aeris)..."
    ExecWait '$4'
  ${EndIf}

  ; Start Aeris after a normal install, or when an update asks for it.
  StrCpy $5 "no"
  ${IfNot} ${Silent}
    StrCpy $5 "yes"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/RELAUNCH" $6
  ${IfNot} ${Errors}
    StrCpy $5 "yes"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "--force-run" $6
  ${IfNot} ${Errors}
    StrCpy $5 "yes"
  ${EndIf}
  ${If} $5 == "yes"
    Exec '"$0\aeris.exe"'
  ${EndIf}
SectionEnd

Section "Uninstall"
  ; $INSTDIR is the folder this uninstaller is in. Your profile (bookmarks, passwords, settings)
  ; stays, like Aero's did, in case you install Aeris again.
  !insertmacro WaitForAeris "$INSTDIR"
  ${IfNot} ${FileExists} "$INSTDIR\aeris.exe"
    Abort
  ${EndIf}
  Delete "$SMPROGRAMS\Aeris.lnk"
  Delete "$DESKTOP\Aeris.lnk"
  Delete "$SMPROGRAMS\Aquaris.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${AERIS_UNINSTALL}"
  DeleteRegKey HKCU "Software\Aeris"
SectionEnd
