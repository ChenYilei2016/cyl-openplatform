import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CustomerDocuments from './documentation/CustomerDocuments';
import './styles.css';

// 新旧入口共用公开门户，API 配置按需验证平台会话。
createRoot(document.getElementById('root')!).render(<StrictMode><CustomerDocuments /></StrictMode>);
