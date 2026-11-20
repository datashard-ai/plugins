---
name: record-with-gh0stwriter
description: Records a call or meeting and transcribes it with the gh0stwriter command line tool, only where gh0stwriter is installed. Use when the person asks to record a call, transcribe a meeting, or stop recording a call.
---

# Record a call with gh0stwriter

gh0stwriter is a command line tool for macOS 14 or later. It takes the microphone (and the call's sound, if the person
set that up), then writes a transcript. A call is capped at 3 hours, and only one recording runs at a time.

## 1. Is it installed?

Run `command -v gh0stwriter`. If it finds nothing, say in one line that gh0stwriter is not installed, give
`curl -fsSL https://raw.githubusercontent.com/datashard-ai/gh0stwriter/main/install.sh | sh`, and stop.
Never install it yourself, and don't bring it up again in this conversation.

## 2. Before you start

Start only when the person asks. First tell them:

> Tell everyone on the call that it is being recorded.

Also tell them where the audio goes. Read only the `engine` line, with `grep '^engine' ~/.config/gh0stwriter/config.toml`,
and never print that file: it holds the API key. With `local`, say "transcribed on this Mac, nothing leaves it". With
anything else, or no `engine` line, say "sent to AssemblyAI's EU API". For a client's call, the client must agree first.
Wait for their go.

## 3. Start

Run `gh0stwriter record --title "<title>"`. It returns within a second and prints the run folder. Report that folder and
say "Recording now." Add `--minutes N` if the person wants it to stop by itself.

## 4. Stop

When the person says the call is over, run `gh0stwriter stop --quiet`. Always with `--quiet`: without it the whole
transcript is printed into this session. It waits for the transcript, up to 10 minutes plus half the audio's length, and
the shell tool gives up after 2 minutes by default and 10 at most. So run it as a background command where you have one.
Where you don't, ask the person to run it in a terminal. Say "Recording stopped."

If it is cut off, the audio is kept: `gh0stwriter transcribe <run>` tries again.

## 5. The transcript and the speakers

The transcript is `transcript.md` in the run folder. Read it only when the person asks you to work with it.

`gh0stwriter speakers <run>` lists the speakers with their first lines. To name them, add `KEY=SIDE:NAME` for each, such
as `you=us:Bob 1=client:Alice`. The side is `us`, `client` or `other`.

## 6. When a command fails

- Exit 2 (no API key or no model) or 3 (sox not found): run `gh0stwriter doctor` and tell the person what it says is
  missing. Setting the API key or the engine (`gh0stwriter config`) is theirs to do, in their own terminal.
- Exit 4 (a recording is already running, the input is silent, ...): tell them what it said.
- Exit 5: the transcription failed and the audio is kept. Offer `gh0stwriter transcribe <run>`.

## 7. Keep it out of Datashard

A transcript is personal data: never save it, or quotes from it, to Datashard. A decision or requirement from the call
goes through the `save-to-datashard` skill, with the person's yes.
