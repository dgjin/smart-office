import React, { useState } from 'react';
import { Plus, Edit2, Trash2, ChevronRight, Building2 } from 'lucide-react';
import { MobileAdminPage } from '../common/MobileAdminPage';
import { createDepartment, updateDepartment, deleteDepartment } from '../../../services/supabaseService';

interface DepartmentManagementProps {
  departments: any[];
  theme: string;
  onBack: () => void;
  onUpdate: (departments: any[]) => void;
}

export const DepartmentManagement: React.FC<DepartmentManagementProps> = ({
  departments,
  theme,
  onBack,
  onUpdate
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingDept, setEditingDept] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', parentId: '' });

  // Build tree structure
  const buildTree = (parentId: string | null = null, level = 0): any[] => {
    return departments
      .filter((d: any) => d.parentId === parentId)
      .map((d: any) => ({
        ...d,
        level,
        children: buildTree(d.id, level + 1)
      }));
  };

  const treeData = buildTree();

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expanded);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpanded(newExpanded);
  };

  const handleAdd = (parentId: string = '') => {
    setEditingDept(null);
    setFormData({ name: '', parentId });
    setShowModal(true);
  };

  const handleEdit = (dept: any) => {
    setEditingDept(dept);
    setFormData({ name: dept.name, parentId: dept.parentId || '' });
    setShowModal(true);
  };

  const handleDelete = async (dept: any) => {
    if (confirm(`确定要删除部门 "${dept.name}" 吗？`)) {
      const hasChildren = departments.some((d: any) => d.parentId === dept.id);
      if (hasChildren) {
        alert('请先删除该部门下的所有子部门');
        return;
      }
      try {
        await deleteDepartment(dept.id);
        const newDepts = departments.filter((d: any) => d.id !== dept.id);
        onUpdate(newDepts);
      } catch (error) {
        console.error('删除部门失败:', error);
        alert('删除失败，请检查网络连接');
      }
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      alert('请输入部门名称');
      return;
    }

    try {
      if (editingDept) {
        const updatedDept = await updateDepartment(editingDept.id, {
          name: formData.name,
          parentId: formData.parentId || null
        });
        const newDepts = departments.map((d: any) =>
          d.id === editingDept.id ? updatedDept : d
        );
        onUpdate(newDepts);
      } else {
        const newDept = await createDepartment({
          name: formData.name,
          parentId: formData.parentId || null
        });
        onUpdate([...departments, newDept]);
      }
      setShowModal(false);
    } catch (error) {
      console.error('保存部门失败:', error);
      alert('保存失败，请检查网络连接');
    }
  };

  const renderTreeNode = (node: any) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expanded.has(node.id);

    return (
      <div key={node.id} className="select-none">
        <div
          className="flex items-center py-3 px-2 hover:bg-gray-50 rounded-lg group"
          style={{ paddingLeft: `${node.level * 20 + 8}px` }}
        >
          <button
            onClick={() => hasChildren && toggleExpand(node.id)}
            className={`w-6 h-6 flex items-center justify-center rounded mr-1 transition-transform ${hasChildren ? 'hover:bg-gray-200' : ''} ${isExpanded ? 'rotate-90' : ''}`}
          >
            {hasChildren && <ChevronRight size={16} className="text-gray-400" />}
          </button>

          <Building2 size={18} className={`text-${theme}-600 mr-2`} />

          <span className="flex-1 font-medium text-gray-800 text-sm">{node.name}</span>

          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => handleAdd(node.id)}
              className="p-1.5 hover:bg-gray-200 rounded-full text-gray-500"
              title="添加子部门"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={() => handleEdit(node)}
              className="p-1.5 hover:bg-gray-200 rounded-full text-gray-500"
              title="编辑"
            >
              <Edit2 size={14} />
            </button>
            <button
              onClick={() => handleDelete(node)}
              className="p-1.5 hover:bg-red-100 rounded-full text-red-500"
              title="删除"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="border-l-2 border-gray-100 ml-4">
            {node.children.map((child: any) => renderTreeNode(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <MobileAdminPage
      title="部门管理"
      theme={theme}
      onBack={onBack}
      action={{
        icon: <Plus size={20} />,
        onClick: () => handleAdd()
      }}
    >
      {/* Tree View */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {treeData.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Building2 size={40} className="mx-auto mb-2 opacity-30" />
            <p>暂无部门数据</p>
          </div>
        ) : (
          <div className="py-2">
            {treeData.map((node: any) => renderTreeNode(node))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center justify-center space-x-4 text-xs text-gray-400">
        <span className="flex items-center"><div className={`w-2 h-2 rounded-full bg-${theme}-500 mr-1`}></div>顶级部门</span>
        <span className="flex items-center"><div className="w-2 h-2 rounded-full bg-gray-300 mr-1"></div>子部门</span>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4" style={{ maxWidth: '448px', margin: '0 auto' }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm animate-in zoom-in-95">
            <h3 className="font-bold text-lg text-gray-800 mb-4">
              {editingDept ? '编辑部门' : '新增部门'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">部门名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="请输入部门名称"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">上级部门</label>
                <select
                  value={formData.parentId}
                  onChange={(e) => setFormData({ ...formData, parentId: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all bg-white"
                >
                  <option value="">无（顶级部门）</option>
                  {departments
                    .filter((d: any) => d.id !== editingDept?.id)
                    .map((d: any) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                </select>
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className={`flex-1 py-3 bg-${theme}-600 text-white rounded-xl font-bold`}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </MobileAdminPage>
  );
};
