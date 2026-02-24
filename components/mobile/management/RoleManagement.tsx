import React, { useState } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { MobileAdminPage } from '../common/MobileAdminPage';
import { createRole, updateRole, deleteRole } from '../../../services/supabaseService';

interface RoleManagementProps {
  roles: any[];
  theme: string;
  onBack: () => void;
  onUpdate: (roles: any[]) => void;
}

const colorOptions = ['indigo', 'emerald', 'amber', 'rose', 'cyan', 'violet', 'orange', 'pink'];

export const RoleManagement: React.FC<RoleManagementProps> = ({
  roles,
  theme,
  onBack,
  onUpdate
}) => {
  const [showModal, setShowModal] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', description: '', color: 'indigo' });

  const handleAdd = () => {
    setEditingRole(null);
    setFormData({ name: '', description: '', color: 'indigo' });
    setShowModal(true);
  };

  const handleEdit = (role: any) => {
    setEditingRole(role);
    setFormData({ 
      name: role.name, 
      description: role.description || '', 
      color: role.color || 'indigo' 
    });
    setShowModal(true);
  };

  const handleDelete = async (role: any) => {
    if (confirm(`确定要删除角色 "${role.name}" 吗？`)) {
      try {
        await deleteRole(role.id);
        const newRoles = roles.filter((r: any) => r.id !== role.id);
        onUpdate(newRoles);
      } catch (error) {
        console.error('删除角色失败:', error);
        alert('删除失败，请检查网络连接');
      }
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      alert('请输入角色名称');
      return;
    }

    try {
      if (editingRole) {
        const updatedRole = await updateRole(editingRole.id, formData);
        const newRoles = roles.map((r: any) =>
          r.id === editingRole.id ? updatedRole : r
        );
        onUpdate(newRoles);
      } else {
        const newRole = await createRole(formData);
        onUpdate([...roles, newRole]);
      }
      setShowModal(false);
    } catch (error) {
      console.error('保存角色失败:', error);
      alert('保存失败，请检查网络连接');
    }
  };

  return (
    <MobileAdminPage
      title="角色管理"
      theme={theme}
      onBack={onBack}
      action={{ icon: <Plus size={20} />, onClick: handleAdd }}
    >
      <div className="space-y-3">
        {roles.map((r: any) => (
          <div key={r.id} className="bg-white p-4 rounded-xl border border-gray-100 group">
            <div className="flex items-center space-x-3">
              <div className={`w-4 h-4 rounded-full bg-${r.color}-500`} />
              <div className="flex-1">
                <p className="font-bold text-gray-800">{r.name}</p>
                <p className="text-xs text-gray-400">{r.description || '暂无描述'}</p>
              </div>
              <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => handleEdit(r)} className="p-1.5 hover:bg-gray-200 rounded-full text-gray-500">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => handleDelete(r)} className="p-1.5 hover:bg-red-100 rounded-full text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4" style={{ maxWidth: '448px', margin: '0 auto' }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm animate-in zoom-in-95">
            <h3 className="font-bold text-lg text-gray-800 mb-4">{editingRole ? '编辑角色' : '新增角色'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色名称 *</label>
                <input 
                  type="text" 
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value})} 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none" 
                  placeholder="请输入角色名称" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea 
                  value={formData.description} 
                  onChange={e => setFormData({...formData, description: e.target.value})} 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none resize-none" 
                  rows={3} 
                  placeholder="请输入角色描述" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">颜色标识</label>
                <div className="flex flex-wrap gap-2">
                  {colorOptions.map(c => (
                    <button
                      key={c}
                      onClick={() => setFormData({...formData, color: c})}
                      className={`w-8 h-8 rounded-full bg-${c}-500 ${formData.color === c ? 'ring-2 ring-offset-2 ring-gray-800' : ''}`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex space-x-3 mt-6">
              <button onClick={() => setShowModal(false)} className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold">取消</button>
              <button onClick={handleSave} className={`flex-1 py-3 bg-${theme}-600 text-white rounded-xl font-bold`}>保存</button>
            </div>
          </div>
        </div>
      )}
    </MobileAdminPage>
  );
};
