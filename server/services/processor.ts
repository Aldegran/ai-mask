
export interface Command {
    type: string;
    content: string;
}

export class ProtocolProcessor {
    // Regex matches [COMMAND] or [COMMAND: Content]
    // Group 1: Command Name (e.g. SAY, THINK, PONG)
    // Group 2: Content (optional)
    private static REGEX = /\[([A-Z_]+)(?::\s*(.*?))?\]/g; 

    /**
     * Parses a text string for protocol markers.
     * Returns a list of found commands.
     * @param text The raw text from the model
     */
    static parse(text: string): Command[] {
        const commands: Command[] = [];
        let match;
        
        // Clone regex for safety with 'g' flag
        const re = new RegExp(this.REGEX);
        
        let foundAny = false;

        while ((match = re.exec(text)) !== null) {
            foundAny = true;
            const type = match[1].toUpperCase();
            const content = match[2] ? match[2].trim() : "";
            commands.push({ type, content });
        }

        // Fallback: If no commands found, usually implies a thought or a direct chat?
        // In our strict system prompt, we expect commands. 
        // But if the model just "Talks", we might want to wrap it in a default type 
        // or just return empty and let the caller decide.
        // For now, let's just return what we found.
        
        return commands;
    }
}
