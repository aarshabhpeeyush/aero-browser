; Register Aero as a browser candidate in Windows Settings > Default apps.
; Windows owns the final UserChoice values, so this advertises associations without
; silently making Aero the default browser.
!macro customInstall
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser" "" "Aero Browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\DefaultIcon" "" `"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0`
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\shell\open\command" "" `"$INSTDIR\${APP_EXECUTABLE_FILENAME}"`
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\Capabilities" "ApplicationName" "Aero Browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\Capabilities" "ApplicationDescription" "Browse the web with Aero Browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\Capabilities" "ApplicationIcon" `"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0`
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\Capabilities" "StartMenuInternet" "Aero Browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\Capabilities\URLAssociations" "http" "AeroURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\Capabilities\URLAssociations" "https" "AeroURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\Capabilities\FileAssociations" ".htm" "AeroHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\Capabilities\FileAssociations" ".html" "AeroHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\Capabilities\FileAssociations" ".xht" "AeroHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\Capabilities\FileAssociations" ".xhtml" "AeroHTML"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\Capabilities\FileAssociations" ".shtml" "AeroHTML"
  WriteRegStr HKCU "Software\RegisteredApplications" "Aero Browser" "Software\Clients\StartMenuInternet\Aero Browser\Capabilities"

  WriteRegStr HKCU "Software\Classes\AeroURL" "" "Aero Browser URL"
  WriteRegStr HKCU "Software\Classes\AeroURL" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\AeroURL\DefaultIcon" "" `"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0`
  WriteRegStr HKCU "Software\Classes\AeroURL\shell\open\command" "" `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"`

  WriteRegStr HKCU "Software\Classes\AeroHTML" "" "HTML Document"
  WriteRegStr HKCU "Software\Classes\AeroHTML\DefaultIcon" "" `"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0`
  WriteRegStr HKCU "Software\Classes\AeroHTML\shell\open\command" "" `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"`

  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\InstallInfo" "ReinstallCommand" `"$INSTDIR\${APP_EXECUTABLE_FILENAME}"`
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\InstallInfo" "HideIconsCommand" `"$INSTDIR\${APP_EXECUTABLE_FILENAME}"`
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Aero Browser\InstallInfo" "ShowIconsCommand" `"$INSTDIR\${APP_EXECUTABLE_FILENAME}"`
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\RegisteredApplications" "Aero Browser"
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Aero Browser"
  DeleteRegKey HKCU "Software\Classes\AeroURL"
  DeleteRegKey HKCU "Software\Classes\AeroHTML"
!macroend
