import React, { useState } from 'react';
import { Plus, Edit2, Trash2, Monitor, Coffee, MapPin, Users } from 'lucide-react';
import { MobileAdminPage } from '../common/MobileAdminPage';
import { createResource, updateResource, deleteResource } from '../../../services/supabaseService';
import { Resource, ResourceType, ResourceStatus } from '../../../types';

interface ResourceManagementProps {
  resources: Resource[];
  theme: string;
  onBack: () => void;
  onUpdate: (resources: Resource[]) => void;
}

const statusOptions: { value: ResourceStatus; label: string; color: string }[] = [
  { value: 'AVAILABLE', label: '空闲', color: 'emerald' },
  { value: 'OCCUPIED', label: '占用', color: 'rose' },
  { value: 'MAINTENANCE', label: '维护中', color: 'amber' },
  { value: 'PENDING', label: '待审核', color: 'gray' },
];

const featureOptions = [
  '投屏显示器', '视频会议系统', '白板', '多孔插座', '双显示器', 
  '电话', '打印机', '空调', '冰箱', '微波炉', '咖啡机'
];

export const ResourceManagement: React.FC<ResourceManagementProps> = ({
  resources,
  theme,
  onBack,
  onUpdate
}) => {
  const [showModal, setShowModal] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [filterType, setFilterType] = useState<ResourceType | 'ALL'>('ALL');
  const [formData, setFormData] = useState({
    name: '',
    type: 'ROOM' as ResourceType,
    capacity: 1,
    location: '',
    features: [] as string[],
    status: 'AVAILABLE' as ResourceStatus
  });

  const handleAdd = () => {
    setEditingResource(null);
    setFormData({
      name: '',
      type: 'ROOM',
      capacity: 1,
      location: '',
      features: [],
      status: 'AVAILABLE'
    });
    setShowModal(true);
  };

  const handleEdit = (resource: Resource) => {
    setEditingResource(resource);
    setFormData({
      name: resource.name,
      type: resource.type,
      capacity: resource.capacity || 1,
      location: resource.location,
      features: resource.features || [],
      status: resource.status
    });
    setShowModal(true);
  };

  const handleDelete = async (resource: Resource) => {
    if (confirm(`确定要删除资源 "${resource.name}" 吗？`)) {
      try {
        await deleteResource(resource.id);
        const newResources = resources.filter(r => r.id !== resource.id);
        onUpdate(newResources);
      } catch (error) {
        console.error('删除资源失败:', error);
        alert('删除失败，请检查网络连接');
      }
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.location.trim()) {
      alert('请填写资源名称和位置');
      return;
    }

    try {
      if (editingResource) {
        const updatedResource = await updateResource(editingResource.id, formData);
        const newResources = resources.map(r =>
          r.id === editingResource.id ? updatedResource : r
        );
        onUpdate(newResources);
      } else {
        const newResource = await createResource(formData);
        onUpdate([...resources, newResource]);
      }
      setShowModal(false);
    } catch (error) {
      console.error('保存资源失败:', error);
      alert('保存失败，请检查网络连接');
    }
  };

  const toggleFeature = (feature: string) => {
    const newFeatures = formData.features.includes(feature)
      ? formData.features.filter(f => f !== feature)
      : [...formData.features, feature];
    setFormData({ ...formData, features: newFeatures });
  };

  const filteredResources = filterType === 'ALL' 
    ? resources 
    : resources.filter(r => r.type === filterType);

  const getStatusInfo = (status: ResourceStatus) => {
    return statusOptions.find(s => s.value === status) || statusOptions[0];
  };

  return (
    <MobileAdminPage
      title="资源管理"
      theme={theme}
      onBack={onBack}
      action={{ icon: <Plus size={20} />, onClick: handleAdd }}
    >
      {/* Filter Tabs */}
      <div className="flex space-x-2 mb-4">
        {['ALL', 'ROOM', 'DESK'].map(type => (
          <button
            key={type}
            onClick={() => setFilterType(type as ResourceType | 'ALL')}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              filterType === type 
                ? `bg-${theme}-600 text-white shadow-md` 
                : 'bg-white text-gray-500 border border-gray-200'
            }`}
          >
            {type === 'ALL' ? '全部' : type === 'ROOM' ? '会议室' : '工位'}
          </button>
        ))}
      </div>

      {/* Resource List */}
      <div className="space-y-3">
        {filteredResources.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <MapPin size={40} className="mx-auto mb-3 opacity-30" />
            <p>暂无资源数据</p>
          </div>
        ) : (
          filteredResources.map(resource => {
            const statusInfo = getStatusInfo(resource.status);
            return (
              <div key={resource.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm group">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      resource.type === 'ROOM' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'
                    }`}>
                      {resource.type === 'ROOM' ? <Monitor size={24} /> : <Coffee size={24} />}
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-800">{resource.name}</h4>
                      <p className="text-xs text-gray-400">{resource.location}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-bold bg-${statusInfo.color}-50 text-${statusInfo.color}-600 border border-${statusInfo.color}-100`}>
                    {statusInfo.label}
                  </span>
                </div>

                <div className="flex items-center space-x-4 text-xs text-gray-500 mb-3">
                  <span className="flex items-center space-x-1">
                    <Users size={12} />
                    <span>{resource.capacity || 1}人</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <MapPin size={12} />
                    <span>{resource.type === 'ROOM' ? '会议室' : '工位'}</span>
                  </span>
                </div>

                {resource.features && resource.features.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {resource.features.slice(0, 3).map((feature, idx) => (
                      <span key={idx} className="px-2 py-0.5 bg-gray-50 text-gray-500 rounded text-[10px]">
                        {feature}
                      </span>
                    ))}
                    {resource.features.length > 3 && (
                      <span className="px-2 py-0.5 bg-gray-50 text-gray-400 rounded text-[10px]">
                        +{resource.features.length - 3}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-end space-x-2 pt-2 border-t border-gray-50 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => handleEdit(resource)} 
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg flex items-center space-x-1"
                  >
                    <Edit2 size={12} /><span>编辑</span>
                  </button>
                  <button 
                    onClick={() => handleDelete(resource)} 
                    className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg flex items-center space-x-1"
                  >
                    <Trash2 size={12} /><span>删除</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4" style={{ maxWidth: '448px', margin: '0 auto' }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto animate-in zoom-in-95">
            <h3 className="font-bold text-lg text-gray-800 mb-4">
              {editingResource ? '编辑资源' : '新增资源'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">资源名称 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none"
                  placeholder="如：战略会议室A"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">资源类型 *</label>
                <div className="flex space-x-2">
                  {[
                    { value: 'ROOM', label: '会议室', icon: Monitor, color: 'indigo' },
                    { value: 'DESK', label: '工位', icon: Coffee, color: 'emerald' }
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => setFormData({...formData, type: option.value as ResourceType})}
                      className={`flex-1 py-3 rounded-xl border-2 flex items-center justify-center space-x-2 transition-all ${
                        formData.type === option.value 
                          ? `border-${option.color}-500 bg-${option.color}-50 text-${option.color}-600`
                          : 'border-gray-200 text-gray-500'
                      }`}
                    >
                      <option.icon size={18} />
                      <span className="font-medium">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">位置 *</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={e => setFormData({...formData, location: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none"
                  placeholder="如：1号楼 10层"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">容量（人数）</label>
                <input
                  type="number"
                  min="1"
                  value={formData.capacity}
                  onChange={e => setFormData({...formData, capacity: parseInt(e.target.value) || 1})}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
                <select
                  value={formData.status}
                  onChange={e => setFormData({...formData, status: e.target.value as ResourceStatus})}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 outline-none bg-white"
                >
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">设施设备</label>
                <div className="flex flex-wrap gap-2">
                  {featureOptions.map(feature => (
                    <button
                      key={feature}
                      onClick={() => toggleFeature(feature)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        formData.features.includes(feature)
                          ? `bg-${theme}-100 text-${theme}-700 border border-${theme}-300`
                          : 'bg-gray-100 text-gray-600 border border-gray-200'
                      }`}
                    >
                      {feature}
                    </button>
                  ))}
                </div>
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
