<script setup lang="ts">
import EventBlock from '../Event/EventBlock.vue'
import TaskLine from '../Task/TaskLine.vue'
import type { IndexedSchedule, IndexedTaskLine } from './scheduleData'

const props = defineProps<{
  schedules?: IndexedSchedule[]
  taskLines?: IndexedTaskLine[]
  layout: { startMinute: number, pixelsPerMinute: number, edgePixels: number, offsetY: number }
  selectedScheduleId: number | null
  focusProgress: number
  focusedMarkers: boolean
  moving: boolean
  interactive: boolean
}>()

const emit = defineEmits<{
  select: [scheduleId: number]
  edit: [eventId: number]
}>()

function minutesToY(minutes: number) {
  const { startMinute, pixelsPerMinute, edgePixels, offsetY } = props.layout
  return (minutes - startMinute) * pixelsPerMinute + edgePixels + offsetY
}
</script>

<template>
  <div class="schedule-day-column">
    <EventBlock
      v-for="{ event, schedule, start, end } in schedules"
      :key="`${event.id}:${schedule.id}`"
      :top="minutesToY(start)"
      :height="(end - start) * layout.pixelsPerMinute"
      :color="event.color"
      :event-id="event.id"
      :event-name="event.name"
      :start-time="schedule.startTime"
      :end-time="schedule.endTime"
      :location="schedule.location || event.location"
      :organizer="schedule.organizer || event.organizer || null"
      :focused="selectedScheduleId === schedule.id"
      :focus-progress="focusProgress"
      :tips="event.tips"
      :moving="moving"
      @select="emit('select', schedule.id)"
      @edit="emit('edit', $event)"
    />
    <TaskLine
      v-for="line in taskLines"
      :key="line.key"
      :top="minutesToY(line.minutes)"
      :covered="(focusedMarkers ? line.focused : line.normal).covered"
      :marker-offset="(focusedMarkers ? line.focused : line.normal).offset"
      :kind="line.kind"
      :task-id="line.task.id"
      :task="line.task"
      :interactive="interactive"
      :task-name="line.task.title"
      :planned-date="line.kind === 'plan' ? line.task.plannedDate ?? undefined : undefined"
      :due-date="line.kind === 'due' ? line.task.dueDate ?? undefined : undefined"
    />
  </div>
</template>

<style scoped>
.schedule-day-column {
  position: relative;
  min-width: 0;
  border-left: 1px solid var(--border-color);
  container-type: inline-size;
  container-name: schedule-day;
}
</style>
