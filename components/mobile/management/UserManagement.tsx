import React, { useState } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { MobileAdminPage } from '../common/MobileAdminPage';
import { createUser, updateUser, deleteUser } from '../../../services/supabaseService';

interface UserManagementProps {
  users: any[];
  departments: any[];
  roles: any[];
  theme: string;
  onBack: () => void;
  onUpdate: (users: any[]) => void;
}

export const UserManagement: React.FC<UserManagementProps> = ({
  users,
  departments,
  roles,
  theme,
  onBack,
  onUpdate
}) => {
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    mobile: '',
    landline: '',
    department: '',
    role: [] as string[]
  });

  const isFinanceTheme = theme === 'finance';
  const darkBg = isFinanceTheme ? 'bg-[#1E293B] border-[#334155]' : 'bg-white border-gray-100';
  const darkText = isFinanceTheme ? 'text-white' : 'text-gray-800';
  const darkSubtext = isFinanceTheme ? 'text-white/60' : 'text-gray-400';
  const darkBorder = isFinanceTheme ? 'border-[#334155]' : 'border-gray-100';
  const darkCardBg = isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white';
  const darkIconBg = isFinanceTheme ? 'bg-[#334155] text-[#F59E0B]' : `bg-${theme}-100 text-${theme}-600`;
  const darkButtonBg = isFinanceTheme ? 'bg-[#334155] text-white/80' : 'bg-gray-100 text-gray-600';
  const darkPrimaryButton = isFinanceTheme ? 'bg-[#F59E0B] text-[#0F172A]' : `bg-${theme}-600 text-white`;
  const darkModalBg = isFinanceTheme ? 'bg-[#1E293B] border-[#334155]' : 'bg-white border-gray-100';
  const darkInputBg = isFinanceTheme ? 'bg-[#334155] border-[#475569] text-white' : 'bg-white border-gray-200 text-gray-800';
  const darkLabelText = isFinanceTheme ? 'text-white/80' : 'text-gray-700';

  const handleAdd = () => {
    setEditingUser(null);
    setFormData({ name: '', email: '', mobile: '', landline: '', department: '', role: ['EMPLOYEE'] });
    setShowModal(true);
  };

  const handleEdit = (user: any) => {
    setEditingUser(user);
    setFormData({
      name: user.name || '',
      email: user.email || '',
      mobile: user.mobile || '',
      landline: user.landline || '',
      department: user.department || '',
      role: user.role || ['EMPLOYEE']
    });
    setShowModal(true);
  };

  const handleDelete = async (user: any) => {
    if (confirm(`确定要删除用户 "${user.name}" 吗？`)) {
      try {
        await deleteUser(user.id);
        const newUsers = users.filter((u: any) => u.id !== user.id);
        onUpdate(newUsers);
      } catch (error) {
        console.error('删除用户失败:', error);
        alert('删除失败，请检查网络连接');
      }
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.email.trim()) {
      alert('请填写姓名和邮箱');
      return;
    }

    try {
      if (editingUser) {
        const updatedUser = await updateUser(editingUser.id, formData);
        const newUsers = users.map((u: any) =>
          u.id === editingUser.id ? updatedUser : u
        );
        onUpdate(newUsers);
      } else {
        const newUser = await createUser(formData);
        onUpdate([...users, newUser]);
      }
      setShowModal(false);
    } catch (error) {
      console.error('保存用户失败:', error);
      alert('保存失败，请检查网络连接');
    }
  };

  const toggleRole = (roleId: string) => {
    const newRoles = formData.role.includes(roleId)
      ? formData.role.filter(r => r !== roleId)
      : [...formData.role, roleId];
    setFormData({ ...formData, role: newRoles });
  };

  return (
    <MobileAdminPage
      title="成员中心"
      theme={theme}
      onBack={onBack}
      action={{ icon: <Plus size={20} />, onClick: handleAdd }}
    >
      <div className="space-y-3">
        {users.map((u: any) => (
          <div key={u.id} className={`${darkCardBg} p-4 rounded-xl border ${darkBorder} group`}>
            <div className="flex items-center space-x-3">
              <div className={`w-10 h-10 rounded-full ${darkIconBg} flex items-center justify-center font-bold`}>
                {u.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-bold ${darkText} truncate`}>{u.name}</p>
                <p className={`text-xs ${darkSubtext} truncate`}>{u.email}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {u.role?.map((rid: string) => {
                    const role = roles.find((r: any) => r.id === rid);
                    return role ? (
                      <span key={rid} className={`text-[10px] px-1.5 py-0.5 rounded ${isFinanceTheme ? `bg-[#334155] text-[#F59E0B]` : `bg-${role.color}-100 text-${role.color}-700`}`}>
                        {role.name}
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
              <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => handleEdit(u)} className={`p-1.5 ${isFinanceTheme ? 'hover:bg-[#334155] text-white/80' : 'hover:bg-gray-200 text-gray-500'} rounded-full`}>
                  <Edit2 size={14} />
                </button>
                <button onClick={() => handleDelete(u)} className={`p-1.5 ${isFinanceTheme ? 'hover:bg-[#334155] text-[#F43F5E]' : 'hover:bg-red-100 text-red-500'} rounded-full`}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4" style={{ maxWidth: '448px', margin: '0 auto' }}>
          <div className={`${darkModalBg} rounded-2xl p-6 w-full max-w-sm max-h-[80vh] overflow-y-auto animate-in zoom-in-95 border ${darkBorder}`}>
            <h3 className={`font-bold text-lg ${darkText} mb-4`}>{editingUser ? '编辑成员' : '新增成员'}</h3>
            <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium ${darkLabelText} mb-1`}>姓名 *</label>
                <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className={`w-full px-4 py-3 rounded-xl border ${darkInputBg} focus:border-indigo-500 outline-none`} placeholder="请输入姓名" />
              </div>
              <div>
                <label className={`block text-sm font-medium ${darkLabelText} mb-1`}>邮箱 *</label>
                <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className={`w-full px-4 py-3 rounded-xl border ${darkInputBg} focus:border-indigo-500 outline-none`} placeholder="请输入邮箱" />
              </div>
              <div>
                <label className={`block text-sm font-medium ${darkLabelText} mb-1`}>手机号</label>
                <input type="tel" value={formData.mobile} onChange={e => setFormData({...formData, mobile: e.target.value})} className={`w-full px-4 py-3 rounded-xl border ${darkInputBg} focus:border-indigo-500 outline-none`} placeholder="请输入手机号" />
              </div>
              <div>
                <label className={`block text-sm font-medium ${darkLabelText} mb-1`}>座机</label>
                <input type="tel" value={formData.landline} onChange={e => setFormData({...formData, landline: e.target.value})} className={`w-full px-4 py-3 rounded-xl border ${darkInputBg} focus:border-indigo-500 outline-none`} placeholder="请输入座机号" />
              </div>
              <div>
                <label className={`block text-sm font-medium ${darkLabelText} mb-1`}>部门</label>
                <select value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})} className={`w-full px-4 py-3 rounded-xl border ${darkInputBg} focus:border-indigo-500 outline-none`}>
                  <option value="">请选择部门</option>
                  {departments.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className={`block text-sm font-medium ${darkLabelText} mb-2`}>角色</label>
                <div className="flex flex-wrap gap-2">
                  {roles.map((r: any) => (
                    <button
                      key={r.id}
                      onClick={() => toggleRole(r.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${formData.role.includes(r.id) ? (isFinanceTheme ? `bg-[#F59E0B] text-[#0F172A] border border-[#F59E0B]` : `bg-${r.color}-100 text-${r.color}-700 border border-${r.color}-300`) : darkButtonBg}`}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex space-x-3 mt-6">
              <button onClick={() => setShowModal(false)} className={`flex-1 py-3 ${darkButtonBg} rounded-xl font-bold`}>取消</button>
              <button onClick={handleSave} className={`flex-1 py-3 ${darkPrimaryButton} rounded-xl font-bold`}>保存</button>
            </div>
          </div>
        </div>
      )}
    </MobileAdminPage>
  );
};

export default UserManagement;
