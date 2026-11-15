import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { LocalNotifications } from '@capacitor/local-notifications'
import { planReminders } from '~/utils/reminders'

export default defineNuxtPlugin({
  name: 'reminders',
  dependsOn: ['api'],
  setup(app) {
    const { $native } = useNuxtApp()
    const { reportError } = useAppErrors()
    const router = useRouter()
    const status = useState('reminders:permission', () => ({ display: '', exact: '' }))
    if (Capacitor.getPlatform() !== 'android' || !$native) return
    const authToken = useCookie<string | null>('yutd-auth-token')
    const client = reactive(useApi({ key: 'reminders:all', read: () => $native.getReminderData({ authToken: authToken.value }) }))
    let running = false
    let dirty = false
    let disposed = false
    let restoreAlarms = false

    async function sync() {
      dirty = true
      if (running || disposed || /^\/login\/?$/.test(router.currentRoute.value.path)) return
      running = true
      try {
        do {
          dirty = false
          const data = await client.read().catch(() => null)
          if (!data) break
          const permission = await LocalNotifications.checkPermissions()
          const exact = await LocalNotifications.checkExactNotificationSetting()
          status.value = { display: permission.display, exact: exact.exact_alarm }
          const plan = permission.display === 'granted' ? planReminders(data, new Date(), exact.exact_alarm === 'granted') : []
          if (dirty || disposed) continue
          const restore = restoreAlarms
          restoreAlarms = false
          const { notifications } = await LocalNotifications.getPending()
          const owned = notifications.filter(item => item.extra?.owner === 'yutd-reminders')
          const wanted = new Map(plan.map(item => [item.id, item]))
          const changed = owned.filter(item => wanted.get(item.id)?.extra.signature !== item.extra?.signature)
          if (changed.length) await LocalNotifications.cancel({ notifications: changed.map(item => ({ id: item.id })) })
          if (plan.length) {
            await LocalNotifications.createChannel({ id: 'yutd-reminders', name: '课程与任务提醒', importance: 4, visibility: 0, vibration: true })
            const current = new Map(owned.map(item => [item.id, item.extra?.signature]))
            const additions = plan.filter(item => current.get(item.id) !== item.extra.signature)
            if (additions.length) await LocalNotifications.schedule({ notifications: additions })
            const unchanged = plan.filter(item => current.get(item.id) === item.extra.signature)
            if (restore && unchanged.length) await LocalNotifications.update({ notifications: unchanged })
          }
        } while (dirty && !disposed)
      } catch (error) {
        reportError(error, '同步系统提醒失败')
      } finally {
        running = false
      }
    }
    function queue() {
      dirty = true
      void sync()
    }
    function restore() {
      restoreAlarms = true
      queue()
    }
    window.addEventListener('yutd:reminders-changed', queue)
    app.hook('app:mounted', restore)
    const removeRoute = router.afterEach(queue)
    const listener = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) restore()
      else queue()
    })
    const cleanup = () => {
      disposed = true
      removeRoute()
      window.removeEventListener('yutd:reminders-changed', queue)
      void listener.then(handle => handle.remove()).catch(error => reportError(error, '移除提醒监听失败'))
    }
    app.vueApp.onUnmount(cleanup)
    if (import.meta.hot) import.meta.hot.dispose(cleanup)
  }
})
