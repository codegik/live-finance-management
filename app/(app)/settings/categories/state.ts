export type SettingsState = { error: string | null; message: string | null }

export const SAVED_MESSAGE = 'Saved.'
export const EMPTY_NAME_ERROR = 'Give the category a name.'
export const EMPTY_RULE_ERROR = 'A rule needs a pattern and a category.'
export const DUPLICATE_RULE_ERROR = 'That rule already exists.'
export const UNKNOWN_CATEGORY_ERROR = 'That category no longer exists.'
export const CHOOSE_RULE_ERROR = 'Choose a rule to delete.'
