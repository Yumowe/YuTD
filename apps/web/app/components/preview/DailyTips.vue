<script setup lang="ts">
import { computed } from 'vue'
import { dailyTipDateKey, visibleDailyTips } from '~/utils/dailyTips'

type DailyTips = ApiData<Api['api']['dailytips']['get']>

const props = defineProps<{
  /** 所属阶段 ID。 */
  phaseId?: number
  /** 显示的日期，默认今天。 */
  date?: string
  /** 提示快照对应的日期。 */
  snapshotDate: DailyTips['date'] | undefined
  /** 提示内容及关联信息。 */
  tips: DailyTips['tips'] | undefined
  /** 提示关联的任务数据。 */
  tasks: DailyTips['tasks'] | undefined
  /** 当前日期的课程实例。 */
  occurrences: DailyTips['occurrences'] | undefined
  /** 提示数据是否正在读取。 */
  pending: boolean
}>()

const { now, timeZone } = useSystemTime()

const day = computed(() => props.date || (now.value ? calendarDate(now.value, timeZone.value) : ''))

function tipTime(time: number | null) {
  if (time === null) return '全天'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: timeZone.value, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(time)
}

const visibleTips = computed(() => {
  if (!props.snapshotDate || dailyTipDateKey(props.snapshotDate) !== day.value) return []
  const date = now.value && calendarDate(now.value, timeZone.value) === day.value
    ? now.value
    : parseZonedDateTime(day.value, timeZone.value)
  return visibleDailyTips(props.tips ?? [], props.tasks ?? [], props.occurrences ?? [], day.value, date, timeZone.value, props.phaseId)
})
</script>

<template>
  <section class="daily-tips">
    <ul
      v-if="visibleTips.length"
      class="daily-tips__list"
    >
      <li
        v-for="tip in visibleTips"
        :key="tip.id"
        class="daily-tips__tip"
      >
        <div class="daily-tips__timing">
          <time :datetime="tip.time === null ? undefined : new Date(tip.time).toISOString()">{{ tipTime(tip.time) }}</time>
          <span v-if="tip.ongoing">进行中</span>
          <span v-else-if="tip.overdue">已过时 · 待处理</span>
        </div>
        <div class="daily-tips__content">
          <p>{{ tip.content }}</p>
          <span
            v-if="tip.sources.length"
            class="daily-tips__sources"
          >{{ tip.sources.join('、') }}</span>
        </div>
      </li>
    </ul>
    <p
      v-else-if="!snapshotDate"
      class="daily-tips__empty"
      role="status"
    >
      {{ !day || pending ? '正在加载每日提示……' : '每日提示尚未载入，请重新加载。' }}
    </p>
    <p
      v-else
      class="daily-tips__empty"
      role="status"
    >
      今天暂无提示。
    </p>
  </section>
</template>

<style scoped>
.daily-tips {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.daily-tips__list {
  min-height: 0;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}
.daily-tips__tip {
  display: flex;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
}
.daily-tips__timing {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 4px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.daily-tips__content {
  min-width: 0;
  overflow-wrap: anywhere;
}
.daily-tips__content p {
  margin: 0 0 4px;
  white-space: pre-wrap;
}
.daily-tips__sources,
.daily-tips__empty {
  color: var(--text-secondary);
  font-size: 12px;
}
.daily-tips__empty {
  margin: 0;
}
</style>
