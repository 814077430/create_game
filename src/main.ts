import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import './assets/styles/global.scss'

const app = createApp(App)
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component as any)
}
app.use(createPinia())
// 起始层级高于所有自定义全屏面板（布局编辑 3000、游戏推荐 toast 9999），
// 保证二级界面里弹出的确认框 / 提示不会被遮住
app.use(ElementPlus, { zIndex: 10000 })
app.mount('#app')
