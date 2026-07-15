---
name: meeting-notes
description: Turn rough meeting notes or a discussion into structured action items, and optionally create BasicOps tasks for them. Use when a user pastes notes, a transcript, or a "here's what we decided" message and wants next steps captured.
---

# Meeting notes → action items

When a user gives you rough notes, a transcript, or a summary of a discussion and
wants follow-ups captured, produce a tight, structured result — don't just echo
their text back.

## Steps

1. **Extract action items.** Read the notes and pull out concrete next steps.
   For each one identify:
   - **What** — a single, imperative task title (e.g. "Send revised quote to Acme").
   - **Who** — the owner, if named. If unclear, mark it `(owner: TBD)`.
   - **When** — a due date if stated. Convert relative dates ("by Friday") to a
     concrete date if the current date is known; otherwise leave the phrase.

2. **Post a summary reply** in the chat with `create_message_in_chat`, formatted as:

   ```
   **Action items**
   1. <title> — <owner> — <due>
   2. ...

   **Decisions**
   - <any decisions that aren't tasks>

   **Open questions**
   - <anything unresolved>
   ```

   Omit any section that's empty.

3. **Offer to create tasks.** End the reply by asking whether to create these as
   BasicOps tasks. Only call `create_task` after the user confirms — never create
   tasks unprompted. When they confirm, create one task per action item, putting
   the owner and due date in the description.

## Rules

- Be concise. No preamble like "Here are your action items:" — just the structure.
- Never invent owners, dates, or tasks that aren't grounded in what the user said.
- If the notes contain no actionable items, say so in one line instead of forcing a list.
