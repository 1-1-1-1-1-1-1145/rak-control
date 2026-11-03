import Taro from '@tarojs/taro'

export function toast(title: string, icon: 'none' | 'success' | 'error' = 'none') {
  Taro.showToast({
    title,
    icon: icon === 'error' ? 'none' : icon,
    duration: 2000,
  })
}
