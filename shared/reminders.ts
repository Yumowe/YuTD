export const reminderDefaults = {
  enableReminder: false,
  enableEventReminder: true,
  eventReminderMinutes: 10,
  eventReminderTitle: '{{title}}',
  eventReminderBody: '{{time}} · {{location}}\n{{task}}\n{{tips}}',
  enableTaskReminder: true,
  taskReminderMinutes: 30,
  taskReminderTitle: '{{title}}',
  taskReminderBody: '截止：{{time}}\n{{description}}'
} as const

export const reminderTokens = {
  event: ['title', 'time', 'location', 'task', 'event', 'tips'],
  task: ['title', 'time', 'description', 'task', 'event', 'tips']
} as const
