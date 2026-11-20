---
name: record-with-gh0stwriter
description: Records a call or meeting and transcribes it with the gh0stwriter command line tool, only where gh0stwriter is installed. Use when the person asks to record a call, transcribe a meeting, or stop recording a call.
---

# Record a call with gh0stwriter

gh0stwriter is a command line tool for macOS 14 or later. It takes the microphone (and the call's sound, if the person
set that up), then writes a transcript. A call is capped at 3 hours, and only one recording runs at a time.

## 1. Is it installed?

gh0stwriter is installed if `command -v gh0stwriter` finds it, or `~/.local/bin/gh0stwriter` exists: an agent's shell
may not have `~/.local/bin` on its `PATH`. If it is only at `~/.local/bin/gh0stwriter`, run it by that full path
wherever this skill says `gh0stwriter`. If it is in neither place, say in one line that gh0stwriter is not installed,
give `curl -fsSL https://raw.githubusercontent.com/datashard-ai/gh0stwriter/main/install.sh | sh`, and stop.
Never install it yourself, and don't bring it up again in this conversation.

## 2. Before you start

Start only when the person asks. First tell them:

> Tell everyone on the call that it is being recorded.

Also tell them where the audio goes. Read only the `engine` line, with `grep '^engine' ~/.config/gh0stwriter/config.toml`,
and never print that file: it holds the API key. With `local`, say "transcribed on this Mac, nothing leaves it". With
anything else, or no `engine` line, say "sent to AssemblyAI through its EU endpoint; where AssemblyAI stores uploads is
not confirmed, and it keeps transcripts for 30 days". For a client's call, or audio that must stay in the EU, use the
local engine: `gh0stwriter config --engine local`, which is theirs to run. For a client's call, the client must agree first.
Wait for their go.

## 3. Start

Run `gh0stwriter record --title "<title>"`. It returns within a second and prints the run folder. Report that folder and
say "Recording now." If `record` prints a warning, such as a missing model or a silent microphone, pass it on in the
same message. Add `--minutes N` if the person wants it to stop by itself.

## 4. Stop

When the person says the call is over, run `gh0stwriter stop --quiet <run>`, with the run folder `record` printed.
Always with `--quiet`: without it the whole transcript is printed into this session. It waits for the transcript, up
to 10 minutes plus half the audio's length. Claude Code's shell tool gives up after 2 minutes by default and 10 at
most; other agents' limits differ, and only the Claude Code route has been checked. So for a long call run it as a
background command where you have one, or ask the person to run it in a terminal, the route gh0stwriter documents.

Until it has finished, say "Stopping; I'll confirm when it's done." Say "Recording stopped." only after `stop` exits 0:
its exit status when you ran it, or the person telling you it finished without an error when they ran it. If it exits
2, the recording is still running: see step 6.

If it is cut off, the audio is kept: `gh0stwriter transcribe <run>` tries again, and refuses if the recording is
still running.

## 5. The transcript and the speakers

The transcript is `transcript.md` in the run folder. Read it only when the person asks you to work with it.

Run `gh0stwriter speakers <run>` only when the person asks to name the speakers: it shows each speaker's first two
lines, which is transcript text. To name them, add `KEY=SIDE:NAME` for each, such as `you=us:Bob 1=client:Alice`. The
side is `us`, `client` or `other`.

## 6. When a command fails

- Exit 2 (no API key, or no speech or speaker model): run `gh0stwriter doctor` and tell the person what it says is
  missing. If `stop` exited 2, the recording is still running: say so first, then what fixes it. The fix is theirs, in
  their own terminal: `gh0stwriter model` to download the models, or setting the API key or the engine
  (`gh0stwriter config`). `--engine assemblyai` works only if they accept that the audio goes to AssemblyAI, as in
  step 2. Then run `gh0stwriter stop --quiet <run>` again.
- Exit 3 (sox not found): tell them. `brew install sox` is theirs to run.
- Exit 4 (a recording is already running, the input is silent, ...): tell them what it said.
- Exit 5: the transcription failed and the audio is kept. Offer `gh0stwriter transcribe <run>`.

Installing sox and downloading the models (`gh0stwriter model`) are theirs too: never run either yourself.

## 7. Keep it out of Datashard

A transcript is personal data: never save it, or quotes from it, to Datashard. A decision or requirement from the call
goes through the `save-to-datashard` skill, with the person's yes.
