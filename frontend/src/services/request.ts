import api from './api';

export interface User {
  id?: number;
  name: string;
  email: string;
  gender: string | null; // Male / Female，未设置为 null
  role: string;
  created_at?: string;
  password?: string;
}

export interface PaginationOut<T> {
  items: T[];
  total: number;
}

export const userService = {
  list: (params?: { keyword?: string; page?: number; size?: number }) => 
    api.get<any, PaginationOut<User>>('/users', { params }),
  create: (data: User) => api.post('/users/create', data),
  update: (id: number, data: User) => api.post(`/users/update/${id}`, data),
  delete: (id: number) => api.post(`/users/delete/${id}`),
};

export const authService = {
  login: (data: any) => api.post<any, { user: User }>('/login', data),
  logout: () => api.post('/logout'),
  me: () => api.get<any, { user: User }>('/me'),
  changePassword: (data: any) => api.post<any, any>('/change-password', data),
};
