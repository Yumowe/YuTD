import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { LocalNotifications } from '@capacitor/local-notifications'
import { planReminders } from '~/utils/reminders'

export default defineNuxtPlugin({
  name: 'reminders',
  dependsOn: ['api'],
  setup(app) {
    const { $native, $nativeCapabilities } = useNuxtApp()
    const { reportError } = useAppErrors()
    const router = useRouter()
    const status = useState('reminders:permission', () => ({ display: '', exact: '' }))
    if (Capacitor.getPlatform() !== 'android' || !$native) return
    const native = $native
    const authToken = useCookie<string | null>('yutd-auth-token')
    const client = reactive(useApi({ key: 'reminders:all', read: () => native.getReminderData({ authToken: authToken.value }) }))
    let running = false
    let dirty = false
    let disposed = false

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
          if (!$nativeCapabilities?.features.includes('reminderQueue')) throw new Error('请更新 Android 安装包以启用安全的提醒队列')
          if (plan.length) {
            await LocalNotifications.createChannel({ id: 'yutd-reminders', name: '课程与任务提醒', importance: 4, visibility: 0, vibration: true })
          }
          await native.syncReminders({ authToken: authToken.value, notifications: plan })
          if (!disposed) window.dispatchEvent(new Event('yutd:reminders-synced'))
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
    window.addEventListener('yutd:reminders-changed', queue)
    app.hook('app:mounted', queue)
    const removeRoute = router.afterEach((to) => {
      if (to.name !== 'reminder') queue()
    })
    const listener = App.addListener('appStateChange', queue)
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
