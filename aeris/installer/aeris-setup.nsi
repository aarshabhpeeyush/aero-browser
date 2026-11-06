; Aeris setup. Installs Aeris just for you (no admin needed) by running Firefox's own installer with
; a folder in your user account, moves you over from Aero, then starts Aeris.
; Built in the cloud by .github/workflows/aeris.yml:
;   makensis -DVERSION=1.0.0 -DINNER=<Firefox-style installer> -DICON=aeris.ico -DOUT=Aeris-Setup-1.0.0.exe aeris-setup.nsi
; Options:  /S        quietly (used by updates)
;           /RELAUNCH start Aeris afterwards (also "--force-run", which Aero's updater sends)

Unicode true
!include LogicLib.nsh
!include FileFunc.nsh

Name "Aeris"
Caption "Installing Aeris ${VERSION}"
OutFile "${OUT}"
Icon "${ICON}"
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

!define AERO_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\3545b983-5cb7-5cf5-b0f3-649ad1553ff2"

Section
  ${GetParameters} $R0

  ; Install where Aeris already is, or in a folder just for you.
  ReadRegStr $0 HKCU "Software\Aeris" "InstallDir"
  ${If} $0 == ""
    StrCpy $0 "$LOCALAPPDATA\Programs\Aeris"
  ${EndIf}

  ; When updating, wait (up to a minute) for Aeris to finish closing.
  StrCpy $1 0
  ${DoWhile} ${FileExists} "$0\xul.dll"
    ClearErrors
    FileOpen $2 "$0\xul.dll" a
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

  DetailPrint "Installing Aeris ${VERSION}..."
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "/oname=aeris-full-setup.exe" "${INNER}"
  ExecWait '"$PLUGINSDIR\aeris-full-setup.exe" /S "/InstallDirectoryPath=$0"' $3
  SetOutPath "$TEMP"
  ${If} $3 != 0
  ${OrIfNot} ${FileExists} "$0\aeris.exe"
    MessageBox MB_ICONSTOP "Aeris couldn't be installed (error $3). Please try again." /SD IDOK
    Abort
  ${EndIf}
!ifdef UBLOCK
  ; uBlock Origin comes with Aeris (Firefox adds it to each new profile from here).
  SetOutPath "$0\distribution\extensions"
  File "/oname=uBlock0@raymondhill.net.xpi" "${UBLOCK}"
  SetOutPath "$TEMP"
!endif
  WriteRegStr HKCU "Software\Aeris" "InstallDir" "$0"
  WriteRegStr HKCU "Software\Aeris" "Version" "${VERSION}"

  ; Aero: Aeris brings your bookmarks, settings and passwords over on its first start (they stay
  ; in Aero's data folder, which the uninstaller keeps), so the old browser itself can go.
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
