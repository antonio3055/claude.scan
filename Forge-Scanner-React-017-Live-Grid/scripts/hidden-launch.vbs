' Launches the scanner's server completely invisibly (no console window at
' all) and detached, so it keeps running after start.bat's own window
' closes. Runs "npm run preview" -- the production build, not dev mode --
' redirecting its output to server.log for diagnosis if something goes wrong.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = projectDir
WshShell.Run "cmd /c npm run preview -- --host 127.0.0.1 --port 8080 > server.log 2>&1", 0, False
