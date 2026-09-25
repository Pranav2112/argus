// Dollar amounts, percentages, durations, probabilities and loss language never reach the UI from LLM text.
export const FORBIDDEN = /\$|%|\bprobab|\bchance\b|\blikel(y|ihood)\b|\b\d+\s*(hours?|days?|weeks?|months?|years?)\b|\bloss(es)?\b/i;
