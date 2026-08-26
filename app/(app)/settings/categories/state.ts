export type SettingsState = { error: string | null; message: string | null }

export const SAVED_MESSAGE = 'Saved.'
export const EMPTY_NAME_ERROR = 'Give the category a name.'
export const EMPTY_RULE_ERROR = 'A rule needs a pattern and a category.'
export const DUPLICATE_RULE_ERROR = 'Essa regra já existe.'
export const UNKNOWN_CATEGORY_ERROR = 'Essa categoria não existe mais.'
export const INVALID_GROUP_ERROR = 'Choose one of the four blocks.'
export const SYSTEM_CATEGORY_ERROR = 'Essa categoria é do sistema e não pode ser alterada.'
export const CHOOSE_RULE_ERROR = 'Choose a rule to delete.'
