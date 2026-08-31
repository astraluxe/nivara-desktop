; ─── The installer must be able to replace files the app left running ─────────
;
; Installing over an existing adris stopped with an abort/retry/ignore box on
; `mesh\exo-node.exe`. Retry did not help, because retrying does not release a
; file lock: exo-node was still running.
;
; Mesh starts exo-node.exe as a child process, and nothing stopped it when the
; app quit — `app.exit(0)` does not kill children, and a std::process::Child does
; not kill on drop. So it outlived every session, held its own file open, and the
; next installer could not overwrite it.
;
; The app now stops it on quit and sweeps orphans on startup (see kill_exo_nodes
; in lib.rs), but that only helps somebody who runs the new build. Anyone with an
; orphan running right now — from a crash, or from a version that never cleaned
; up — still cannot install. The installer has to handle it itself.
;
; taskkill rather than a Windows API dance: it is on every Windows, it takes a
; process name, and `/F` releases the handle immediately. Failure is ignored on
; purpose — the usual reason is that nothing was running, which is the good case,
; and an installer must not stop because a cleanup step found nothing to clean.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping the Mesh engine if it is running…"
  nsExec::Exec 'taskkill /F /IM exo-node.exe /T'
  Pop $0
  ; Give Windows a moment to release the handle. Without this the very next file
  ; write can still land inside the closing window and fail exactly as before.
  Sleep 400
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Same reason: an uninstall cannot delete a file that is open either.
  DetailPrint "Stopping the Mesh engine…"
  nsExec::Exec 'taskkill /F /IM exo-node.exe /T'
  Pop $0
  Sleep 400
!macroend
