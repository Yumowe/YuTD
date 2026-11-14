<script setup lang="ts">
const colors = defineModel<number | 'auto'>({ default: 'auto' })
defineProps<{ disabled?: boolean }>()
</script>

<template>
  <label class="color-count-select">
    <span>简化颜色</span>
    <select
      v-model="colors"
      :disabled="disabled"
    >
      <option value="auto">
        自动（16～30 色）
      </option>
      <option
        v-for="count in 19"
        :key="count"
        :value="count + 7"
      >
        {{ count + 7 }} 色
      </option>
    </select>
  </label>
</template>

<style scoped>
.color-count-select { display: inline-flex; align-items: center; gap: 8px; }
</style>
