export function browserPreference(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key)
    localStorage.setItem(key, value)
  } catch {
    // 宿主禁用浏览器存储时，界面偏好仍可在当前窗口使用。
  }
}
