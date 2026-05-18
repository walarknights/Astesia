import axios from 'axios';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage'; // 用于本地存储Token

// 1. 创建 axios 实例
const request = axios.create({
  // 注意：真机调试时不能用 localhost，要用你电脑的局域网 IP
  // Android 模拟器可以使用 10.0.2.2
  baseURL: 'http://10.0.2.2:8080/api', 
  timeout: 10000, // 超时时间 10秒
  headers: {
    'Content-Type': 'application/json',
  }
});

// 2. 请求拦截器 (Request Interceptor)
request.interceptors.request.use(
  async (config) => {
    // 每次发送请求前，从本地获取 Token 并携带上
    const token = await AsyncStorage.getItem('userToken');
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