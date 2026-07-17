import { create } from 'axios';
import { Alert } from 'react-native';

import { storage } from '@/services/storage';

const REAL_BACKEND_API_HOST = 'https://astesia.cc';

// 1. 创建 axios 实例
const request = create({
  // [变更] 修改前: 遗留 axios 工具写死本地 10.0.2.2:8080
  // [变更] 修改后: 统一请求真实后端服务器
  // [原因] 当前所有后端请求都必须绕开本地调试地址
  baseURL: `${REAL_BACKEND_API_HOST}/api`,
  timeout: 10000, // 超时时间 10秒
  headers: {
    'Content-Type': 'application/json',
  }
});

// 2. 请求拦截器 (Request Interceptor)
request.interceptors.request.use(
  async (config) => {
    // [变更] 修改前: axios 直接从 AsyncStorage 读取明文 token
    // [变更] 修改后: 统一从安全存储层读取登录凭证
    // [原因] 原生端禁止绕过 SecureStore 获取 token
    const token = await storage.getItem('userToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 3. 响应拦截器 (Response Interceptor)
request.interceptors.response.use(
  (response) => {
    // 成功接收到数据，可以根据后端的统一格式进行解构
    // 例如后端返回格式为 { code: 200, data: {...}, message: "success" }
    const res = response.data;
    if (res.code !== 200) {
      Alert.alert('提示', res.message || '请求失败');
      return Promise.reject(new Error(res.message || 'Error'));
    }
    return res.data; // 直接返回 data 部分
  },
  (error) => {
    // 处理网络错误、4xx、5xx等状态码
    if (error.response) {
      switch (error.response.status) {
        case 401:
          Alert.alert('登录过期', '请重新登录');
          // 这里可以处理退出登录逻辑
          break;
        case 404:
          Alert.alert('错误', '接口不存在');
          break;
        case 500:
          Alert.alert('服务器错误', '请稍后再试');
          break;
        default:
          Alert.alert('网络错误', '请检查网络连接');
      }
    } else {
      Alert.alert('网络超时', '请检查您的网络');
    }
    return Promise.reject(error);
  }
);

export default request
