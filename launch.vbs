' Runs launch.cmd hidden (no console flash). Used by the desktop shortcut.
Dim sh, here
Set sh = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.CurrentDirectory = here
sh.Run "cmd /c """ & here & "launch.cmd""", 0, False
