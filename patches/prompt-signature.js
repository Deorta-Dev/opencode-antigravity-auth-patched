/**
 * Neutralizes the OpenCode V2 Code Mode prompt signature that Google's
 * server-side filter matches.
 *
 * Since ~2026-11-14, Google's endpoint (daily-cloudcode-pa.googleapis.com)
 * returns a bare 429 RESOURCE_EXHAUSTED for requests whose systemInstruction
 * contains "tools.opencode.session_move". The plugin's quota fallback then
 * surfaces a misleading 403 Forbidden. See upstream issue #622 / PR #623.
 *
 * The transform must run on the parsed object before JSON.stringify, because
 * inserting double quotes into a serialized JSON string would break it.
 */

export const OPENCODE_SIGNATURE_NEEDLE = "tools.opencode.";
export const OPENCODE_SIGNATURE_REPLACEMENT = 'tools["opencode"].';

export function sanitizeOpenCodePromptSignatureText(text) {
    if (typeof text !== "string" || !text.includes(OPENCODE_SIGNATURE_NEEDLE)) {
        return text;
    }
    return text.split(OPENCODE_SIGNATURE_NEEDLE).join(OPENCODE_SIGNATURE_REPLACEMENT);
}

function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeSystemInstructionInPlace(systemInstruction) {
    if (!systemInstruction)
        return;
    if (typeof systemInstruction === "string")
        return;
    if (isPlainObject(systemInstruction)) {
        if (Array.isArray(systemInstruction.parts)) {
            for (const part of systemInstruction.parts) {
                if (isPlainObject(part) && typeof part.text === "string" && part.text.includes(OPENCODE_SIGNATURE_NEEDLE)) {
                    part.text = sanitizeOpenCodePromptSignatureText(part.text);
                }
            }
        }
        else if (typeof systemInstruction.text === "string" && systemInstruction.text.includes(OPENCODE_SIGNATURE_NEEDLE)) {
            systemInstruction.text = sanitizeOpenCodePromptSignatureText(systemInstruction.text);
        }
    }
}

function sanitizeContentsInPlace(contents) {
    for (const content of contents) {
        if (isPlainObject(content) && Array.isArray(content.parts)) {
            for (const part of content.parts) {
                if (isPlainObject(part) && typeof part.text === "string" && part.text.includes(OPENCODE_SIGNATURE_NEEDLE)) {
                    part.text = sanitizeOpenCodePromptSignatureText(part.text);
                }
            }
        }
    }
}

function sanitizeMessagesInPlace(messages) {
    for (const message of messages) {
        if (!isPlainObject(message))
            continue;
        if (Array.isArray(message.content)) {
            for (const block of message.content) {
                if (isPlainObject(block) && typeof block.text === "string" && block.text.includes(OPENCODE_SIGNATURE_NEEDLE)) {
                    block.text = sanitizeOpenCodePromptSignatureText(block.text);
                }
            }
        }
        else if (typeof message.content === "string" && message.content.includes(OPENCODE_SIGNATURE_NEEDLE)) {
            message.content = sanitizeOpenCodePromptSignatureText(message.content);
        }
    }
}

export function sanitizeOpenCodePromptSignatureInPlace(request) {
    if (!request || typeof request !== "object")
        return;
    const systemInstruction = request.systemInstruction;
    if (typeof systemInstruction === "string" && systemInstruction.includes(OPENCODE_SIGNATURE_NEEDLE)) {
        request.systemInstruction = sanitizeOpenCodePromptSignatureText(systemInstruction);
    }
    else if (systemInstruction && typeof systemInstruction === "object") {
        sanitizeSystemInstructionInPlace(systemInstruction);
    }
    const sysAlias = request.system_instruction;
    if (typeof sysAlias === "string" && sysAlias.includes(OPENCODE_SIGNATURE_NEEDLE)) {
        request.system_instruction = sanitizeOpenCodePromptSignatureText(sysAlias);
    }
    else if (sysAlias && typeof sysAlias === "object") {
        sanitizeSystemInstructionInPlace(sysAlias);
    }
    if (Array.isArray(request.contents)) {
        sanitizeContentsInPlace(request.contents);
    }
    if (Array.isArray(request.messages)) {
        sanitizeMessagesInPlace(request.messages);
    }
    if (isPlainObject(request.extra_body) && Array.isArray(request.extra_body.messages)) {
        sanitizeMessagesInPlace(request.extra_body.messages);
    }
}
