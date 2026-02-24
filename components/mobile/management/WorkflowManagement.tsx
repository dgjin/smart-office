import React, { useState } from 'react';
import { Plus, Edit2, Trash2, ArrowUp, ArrowDown, GitMerge } from 'lucide-react';
import { MobileAdminPage } from '../common/MobileAdminPage';
import { updateWorkflow as updateWorkflowDB } from '../../../services/supabaseService';

interface WorkflowManagementProps {
  workflow: any[];
  roles: any[];
  theme: string;
  onBack: () => void;
  onUpdate: (workflow: any[]) => void;
}

export const WorkflowManagement: React.FC<WorkflowManagementProps> = ({
  workflow,
  roles,
  theme,
  onBack,
  onUpdate
}) => {
  const [showModal, setShowModal] = useState(false);
  const [editingNode, setEditingNode] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', approverRole: '' });

  const handleAdd = () => {
    setEditingNode(null);
    setFormData({ name: '', approverRole: roles[0]?.id || '' });
    setShowModal(true);
  };

  const handleEdit = (node: any, index: number) => {
    setEditingNode({ ...node, index });
    setFormData({ name: node.name, approverRole: node.approverRole });
    setShowModal(true);
  };

  const handleDelete = async (index: number) => {
    if (confirm('确定要删除此审批节点吗？')) {
      try {
        const newWorkflow = workflow.filter((_: any, i: number) => i !== index);
        await updateWorkflowDB(newWorkflow);
        onUpdate(newWorkflow);
      } catch (error) {
        console.error('删除流程节点失败:', error);
        alert('删除失败，请检查网络连接');
      }
    }
  };

  const handleMoveUp = async (index: number) => {
    if (index === 0) return;
    try {
      const newWorkflow = [...workflow];
      [newWorkflow[index], newWorkflow[index - 1]] = [newWorkflow[index - 1], newWorkflow[index]];
      await updateWorkflowDB(newWorkflow);
      onUpdate(newWorkflow);
    } catch (error) {
      console.error('移动流程节点失败:', error);
      alert('操作失败，请检查网络连接');
    }
  };

  const handleMoveDown = async (index: number) => {
    if (index === workflow.length - 1) return;
    try {
      const newWorkflow = [...workflow];
      [newWorkflow[index], newWorkflow[index + 1]] = [newWorkflow[index + 1], newWorkflow[index]];
      await updateWorkflowDB(newWorkflow);
      onUpdate(newWorkflow);
    } catch (error) {
      console.error('移动流程节点失败:', error);
      alert('操作失败，请检查网络连接');
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.approverRole) {
      alert('请填写完整信息');
      return;
    }

    try {
      let newWorkflow;
      if (editingNode) {
        newWorkflow = workflow.map((w: any, i: number) =>
          i === editingNode.index ? { ...w, name: formData.name, approverRole: formData.approverRole } : w
        );
      } else {
        const newNode = {
          id: `node-${Date.now()}`,
          name: formData.name,
          approverRole: formData.approverRole,
          sort_order: workflow.length,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        newWorkflow = [...workflow, newNode];
      }
      await updateWorkflowDB(newWorkflow);
      onUpdate(newWorkflow);
      setShowModal(false);
    } catch (error) {
      console.error('保存流程节点失败:', error);
      alert('保存失败，请检查网络连接');
    }
  };

  const getRoleName = (roleId: string) => {
    const role = roles.find((r: any) => r.id === roleId);
    return role?.name || roleId;
  };

  const getRoleColor = (roleId: string) => {
    const role = roles.find((r: any) => r.id === roleId);
    return role?.color || 'gray';
  };

  return (
    <MobileAdminPage
      title="流程配置"
      theme={theme}
      onBack={onBack}
      action={{ icon: <Plus size={20} />, onClick: handleAdd }}
    >
      {/* Visual Workflow */}
      <div className="relative">
        {workflow.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <GitMerge size={48} className="mx-auto mb-3 opacity-30" />
            <p>暂无审批流程</p>
            <p className="text-xs mt-1">点击右上角 + 添加审批节点</p>
          </div>
        ) : (
          <div className="space-y-0">
            {workflow.map((node: any, index: number) => (
              <div key={node.id} className="relative">
                {/* Connector Line */}
                {index > 0 && (
                  <div className="absolute left-6 -top-4 w-0.5 h-4 bg-gray-200" />
                )}

                {/* Node Card */}
                <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4 group relative">
                  <div className="flex items-start space-x-3">
                    {/* Step Number */}
                    <div className={`w-12 h-12 rounded-full bg-${theme}-100 flex items-center justify-center text-${theme}-600 font-bold text-lg shrink-0`}>
                      {index + 1}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-800">{node.name}</p>
                      <div className="flex items-center mt-1">
                        <span className="text-xs text-gray-400 mr-2">审批人:</span>
                        <span className={`text-xs px-2 py-0.5 rounded bg-${getRoleColor(node.approverRole)}-100 text-${getRoleColor(node.approverRole)}-700`}>
                          {getRoleName(node.approverRole)}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col space-y-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleMoveUp(index)}
                        disabled={index === 0}
                        className="p-1 hover:bg-gray-100 rounded disabled:opacity-30"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => handleMoveDown(index)}
                        disabled={index === workflow.length - 1}
                        className="p-1 hover:bg-gray-100 rounded disabled:opacity-30"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Bottom Actions */}
                  <div className="flex items-center justify-end space-x-2 mt-3 pt-3 border-t border-gray-50 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleEdit(node, index)} className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg flex items-center space-x-1">
                      <Edit2 size={12} /><span>编辑</span>
                    </button>
                    <button onClick={() => handleDelete(index)} className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg flex items-center space-x-1">
                      <Trash2 size={12} /><span>删除</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-6 bg-gray-50 rounded-xl p-4">
        <p className="text-xs font-medium text-gray-500 mb-2">流程说明</p>
        <p className="text-xs text-gray-400">审批流程按照节点顺序依次执行，每个节点由指定的角色进行审批。可以通过拖拽或上下箭头调整节点顺序。</p>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4" style={{ maxWidth: '448px', margin: '0 auto' }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm animate-in zoom-in-95">
            <h3 className="font-bold text-lg text-gray-800 mb-4">{editingNode ? '编辑节点' : '新增节点'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">节点名称 *</label>
                <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none" placeholder="如：行政预审" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">审批角色 *</label>
                <select value={formData.approverRole} onChange={e => setFormData({...formData, approverRole: e.target.value})} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none bg-white">
                  <option value="">请选择审批角色</option>
                  {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
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
