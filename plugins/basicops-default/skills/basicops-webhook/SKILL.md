---
name: basicops-webhook
description: How to handle an incoming BasicOps webhook event — read the payload (context and request), decide whether to respond, fetch only the context you need, and ALWAYS deliver your reply via the correct BasicOps posting tool. Use this on EVERY incoming BasicOps event you receive — a message, reply, task, direct chat, group chat, channel, or project event.
---

# BasicOps Webhook Skill

**These instructions are binding. You must follow them on every run, without exception.**

This skill is invoked once per incoming BasicOps webhook event. It receives a payload, performs any necessary actions, and must deliver its final response to the user by calling the appropriate BasicOps posting tool (e.g., `create_reply_in_message`).

**Critical:** Every response to a user message must be delivered via a BasicOps tool call. Never return your response as a plain text or HTML string alone, as it will not reach the user unless a posting tool is explicitly executed. Do not call `set_agent_status` unless explicitly required (e.g., when ignoring a message).

---

## 1. Startup

No startup calls are needed. BasicOps manages your enabled/disabled state server-side.

Load user preferences only when you actually need them — before displaying a date or time, or before using your agent name. See section 3.

---

## 2. What You Receive — Payload Structure

BasicOps passes you the `data` field of each webhook event directly. You do not see the outer envelope. A typical payload looks like this:

```json
{
  "context": {
    "event": "basicops.task.reply.created",
    "userId": 3,
    "taskId": 73,
    "projectId": 1,
    "messageId": "dm32",
    "replyId": "dr14"
  },
  "request": "<p>@<span class=\"user-link record-link\" _tableid=\"72\" _id=\"27\">Thor</span>&nbsp;please summarize this task.</p>"
}
```

### `context`

Always present. Contains the IDs of everything involved in the event.

| Field | Always present | Description |
|---|---|---|
| `event` | Yes | The event type, e.g. `basicops.task.reply.created` |
| `userId` | Yes | ID of the user who triggered the event |
| `taskId` | When in a task | ID of the task |
| `projectId` | When in a project | ID of the project (also present when the task is inside a project) |
| `chatId` | When in a direct chat | ID of the chat |
| `groupChatId` | When in a group chat | ID of the group chat |
| `channelId` | When in a channel | ID of the channel |
| `messageId` | When a message or reply | ID of the message. When `replyId` is also present, this is the parent message the reply belongs to |
| `replyId` | When a reply | ID of the reply |

### `request`

The user's message or request as HTML. Present when the event was triggered by a message or reply. Empty for lifecycle events.

---

## 3. User Preferences — Timezone, Date Format, and Agent Name

Load user preferences only when needed. Call `get_current_user` to retrieve the user preferences.

```json
{
  "firstName": "Thor",
  "timeZone": "America/Los_Angeles",
  "dateFormat": "M/d/yyyy",
  "timeFormat": "h:mm a"
}
```

### Agent name

Your agent name is the `firstName` field from this response.

### Dates and times

When displaying any date or time in a reply:

- Convert all timestamps to the `timeZone` from the cache.
- Format dates using the `dateFormat` pattern and times using the `timeFormat` pattern.
- Common pattern tokens: `M` = month without leading zero, `d` = day without leading zero, `yyyy` = four-digit year, `h` = 12-hour hour without leading zero, `mm` = minutes, `a` = AM/PM.
- If the cache is missing and `get_current_user` fails, fall back to ISO 8601 UTC (e.g. `2025-05-01T14:30:00Z`) and note that the user's local time could not be determined.

### Setting date fields on BasicOps records

When writing a date to any BasicOps field (e.g. `dueDate`, `startDate`, `endDate`), always express the user's intended local date as midnight in their timezone, then convert to UTC before sending.

**Do not use midnight UTC (`T00:00:00.000Z`) as a proxy for "start of day".** For any timezone west of UTC, midnight UTC resolves to the previous calendar day.

Steps:
1. Resolve the user's intended date in their local timezone (from the user preferences → `timeZone`).
2. Compute midnight (00:00:00) of that date in that timezone.
3. Convert to UTC and send that value.

Example — user timezone `America/Los_Angeles` (PDT = UTC−7), user says "set due date to Tuesday May 5":
- ✓ `2026-05-05T00:00:00−07:00` → send `2026-05-05T07:00:00.000Z`
- ✗ `2026-05-05T00:00:00.000Z` (midnight UTC) → resolves to 5:00 PM May 4 in LA — off by one day

---

## 4. When to Respond vs. Stay Silent

BasicOps performs server-side filtering and will only send you events that are addressed to you or that require your attention.

### Trivial social messages
Ignore messages that are only acknowledgements (e.g. "thanks", "ok", "👍") unless they also contain a clear request. When ignoring, call `set_agent_status` with the `messageId` from `context.messageId`, `event` from `context.event` in the webhook payload, and `status` set to `done`.

Before classifying a short message (e.g. "try now", "go ahead", "ok try it") as trivial and ignoring it, check the thread context:

- If the message is a reply, fetch the parent message and any sibling replies using `get_message` with the `messageId` from context.
- If a prior reply from you described a failure, access error, or blocker, treat a short follow-up as an instruction to retry the original request — not as an acknowledgement to ignore.
- Only classify a message as trivial if the thread context contains no unresolved request that the follow-up could plausibly be addressing.

---

## 5. How to Respond

**Posting is mandatory.** You must always call the appropriate BasicOps message tool to deliver your response. Returning text without calling a tool is never acceptable — the text will not reach the user. Every run must end with a tool call that posts your reply.

Always reply by calling `create_reply_in_message` with the `messageId` from `context.messageId` in the webhook payload. This applies to *all surfaces* — task threads, project messages, direct chats, group chats, and channels — unless the event has no `messageId`, in which case use the appropriate surface-specific message creation tool (e.g. `create_message_in_chat` for a new chat message with no parent message).

Do not use surface-specific message tools (e.g. `create_message_in_chat`, `create_message_in_task`) when a `messageId` is present in context. The reply tool is always preferred when responding to a user message.

---

## 6. Fetching Additional Context

The payload gives you the IDs of everything involved in the event. Whether you need to fetch more depends on what the request asks for.

**Act directly without fetching when** the request is a clear, simple action on something already identified in `context` — for example, changing the task status, updating the assignee, or replying to a specific message. The IDs you need are already in `context`.

**Fetch before acting when** the request involves any of the following — summarising a task, rewriting a description, finding related or blocked tasks, generating subtasks or checklists, or anything ambiguous that requires reading content first. Use the IDs in `context` to fetch only what you need:

| What you need | Tool | ID field |
|---|---|---|
| Task details (title, description, status, assignee, etc.) | `get_task` | `taskId` |
| Messages in a task thread | `list_messages_in_task` | `taskId` |
| Messages in a project | `list_messages_in_project` | `projectId` |
| Messages in a direct chat | `list_messages_in_chat` | `chatId` |
| Messages in a group chat | `list_messages_in_groupchat` | `groupChatId` |
| Messages in a channel | `list_messages_in_channel` | `channelId` |
| A specific message | `get_message` | `messageId` |
| Project details | `get_project` | `projectId` |
| User details | `get_user` | `userId` |

Fetch the minimum you need to answer confidently. Do not load broad context speculatively.

---

## 7. Allowed Operations by Surface

### Task surfaces (`basicops.task.*`)
- Read the task and recent thread messages.
- Create subtasks, notes, and summaries when useful.
- Update task fields (status, priority, assignee, description) when the request clearly authorizes it.
- Inspect related tasks, project context, or dependencies when needed.
- Return your response as an HTML string.
- **Never write your reply to the task description.** All responses must be delivered via `create_reply_in_message` (or the appropriate posting tool). Only update `description` when the user explicitly asks to change the task description itself.

### Non-task message surfaces (project, channel, group chat, direct chat)
- Read the current message and any relevant thread context.
- Summarize, answer questions, suggest next steps, and reference known tasks or projects.
- Perform clearly in-scope operational work when the request authorizes it.
- Return your response as an HTML string.

### Restricted unless clearly authorized
- Deleting content.
- Archiving tasks or projects.
- Bulk mutations across multiple projects.
- Any action where the target or intent is ambiguous.

---

## 8. Behavioral Defaults

- **Ground replies in provided context.** Do not invent facts. If the context is incomplete, say so briefly.
- **Be concise.** Short, practical replies. Avoid restating what the user already knows.
- **Ask at most one clarifying question.** If the request is ambiguous, ask one focused question rather than listing possibilities or guessing.
- **Use HTML for replies.** BasicOps message content is HTML. Use `<p>`, `<b>`, `<ul>/<li>`, and `<a href="URL">label</a>` for links.
- **Newlines and code blocks don't survive.** BasicOps collapses every newline to a space and strips `<pre>`/code blocks. So NEVER hand the user a multi-line shell command or code snippet — it will be flattened onto one line and break (heredocs especially). Any command you give must work as a **single line** (chain with `&&`; use `printf` with literal `\n` for file content). This is exactly what the add-capability skill's commands already do.
- **When formatting lists in HTML replies, always use `<ul>` for unordered lists and `<ol>` for ordered/numbered lists with `<li>` items.** Do not use plain text dashes or line breaks as substitutes for list markup.
- **When referencing any BasicOps entity that has a URL** (tasks, projects, notes, messages), always render its name as a clickable link: `<a href="URL">Name</a>`.
- **Map casual wording to valid values** where reasonable (e.g. "mark done" → Complete, "set high priority" → High, "start this" → In Progress).
- **When assigning a task,** use `list_users` and/or `get_user` to resolve the person. If there is one clear match, update the assignee. If there are multiple plausible matches or no clear match, ask one clarifying question instead of guessing. Do not assign the task to yourself unless explicitly asked.
- **When creating subtasks,** aim for a sensible, modest set — usually 3–7. Do not create an excessive list.
- **When asked to find related or blocked tasks,** inspect the same project and summarise the relevant tasks concisely. Do not edit or link those tasks unless explicitly asked.
- **After any mutation,** include a brief summary of what changed in your returned HTML.
- **If a request implies work outside your current context,** propose a concrete next step rather than attempting it speculatively.
