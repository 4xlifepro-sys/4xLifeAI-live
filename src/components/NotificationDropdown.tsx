import React, { useState, useEffect, useRef } from 'react';
import { Bell, Check, X, Award, TrendingUp, TrendingDown, Eye, CheckCircle, XCircle, MessageSquare, Activity, AlertTriangle, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { cn } from '../App';

interface Notification {
  id: string;
  title: string;
  message: string;
  type?: string;
  is_read: boolean;
  created_at: string;
}

export default function NotificationDropdown() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    console.log('Unread notifications count:', unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    if (!user || !supabase) return;

    fetchNotifications();

    const channelId = `user_notifications_${user.id}_${Math.random().toString(36).substring(2, 11)}`;
    const channel = supabase.channel(channelId)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'notifications',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        setNotifications(prev => [payload.new as Notification, ...prev]);
        setUnreadCount(prev => prev + 1);
      })
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'notifications',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        setNotifications(prev => {
          const exists = prev.find(n => n.id === payload.new.id);
          if (exists) {
            if (!exists.is_read && payload.new.is_read) {
              setUnreadCount(c => Math.max(0, c - 1));
            } else if (exists.is_read && !payload.new.is_read) {
              setUnreadCount(c => c + 1);
            }
            return prev.map(n => n.id === payload.new.id ? payload.new as Notification : n);
          }
          
          // If not in local list but updated (e.g. older notification read elsewhere)
          if (payload.new.is_read && !payload.old.is_read) {
            setUnreadCount(c => Math.max(0, c - 1));
          } else if (!payload.new.is_read && payload.old.is_read) {
            setUnreadCount(c => c + 1);
          }
          return prev;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const fetchNotifications = async () => {
    if (!user?.id) return;
    try {
      // Fetch latest 20 notifications for dropdown
      const { data, error } = await supabase
        .from('notifications')
        .select('id, user_id, title, message, is_read, created_at')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(20);
        
      if (error) {
        console.error('Error fetching notifications:', error.message || error);
        return;
      }
      
      // Fetch total unread count
      const { count, error: countError } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .eq('is_read', false);
        
      if (!countError && count !== null) {
        setUnreadCount(count);
      }
        
      if (data) {
        setNotifications(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const markAsRead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const target = notifications.find(n => n.id === id);
      if (target && !target.is_read) {
         setUnreadCount(prev => Math.max(0, prev - 1));
      }
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);
    } catch (e) {
      console.error(e);
    }
  };

  const markAllAsRead = async () => {
    try {
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user!.id)
        .eq('is_read', false);
    } catch (e) {
      console.error(e);
    }
  };

  const getNotificationStyles = (notification: Notification) => {
    const t = (notification.type || '').toLowerCase();
    const title = (notification.title || '').toLowerCase();

    if (t === 'a_grade' || title.includes('grade a')) {
       return { icon: Award, colorClass: 'text-purple-400', bgClass: 'bg-purple-500/10', title: 'A+ GRADE' };
    }
    if (t === 'b_grade' || title.includes('grade b')) {
       const isLong = notification.message.toUpperCase().includes('LONG') || notification.message.toUpperCase().includes('BUY');
       return { 
         icon: isLong ? TrendingUp : TrendingDown, 
         colorClass: isLong ? 'text-blue-400' : 'text-blue-400', 
         bgClass: isLong ? 'bg-blue-500/10' : 'bg-blue-500/10', 
         title: 'B GRADE' 
       };
    }
    if (t === 'c_grade' || title.includes('grade c')) {
       return { icon: Eye, colorClass: 'text-amber-400', bgClass: 'bg-amber-500/10', title: 'C GRADE' };
    }
    if (t === 'payment_approved' || title.includes('payment approved')) {
       return { icon: CheckCircle, colorClass: 'text-emerald-400', bgClass: 'bg-emerald-500/10', title: 'PAYMENT APPROVED' };
    }
    if (t === 'payment_rejected' || title.includes('payment rejected')) {
       return { icon: XCircle, colorClass: 'text-rose-400', bgClass: 'bg-rose-500/10', title: 'PAYMENT REJECTED' };
    }
    if (t === 'ticket_updated' || t === 'ticket_resolved' || title.includes('ticket')) {
       return { icon: MessageSquare, colorClass: 'text-blue-400', bgClass: 'bg-blue-500/10', title: 'SUPPORT TICKET' };
    }
    if (t === 'scanner_online' || title.includes('system online')) {
       return { icon: Activity, colorClass: 'text-emerald-400', bgClass: 'bg-emerald-500/10', title: 'SYSTEM STATUS' };
    }
    if (t === 'scanner_error' || title.includes('scanner error')) {
       return { icon: AlertTriangle, colorClass: 'text-rose-400', bgClass: 'bg-rose-500/10', title: 'SCANNER ERROR' };
    }
    if (t === 'system_alert' || title.includes('system alert')) {
       return { icon: AlertCircle, colorClass: 'text-orange-400', bgClass: 'bg-orange-500/10', title: 'SYSTEM ALERT' };
    }

    return { icon: Bell, colorClass: 'text-blue-400', bgClass: 'bg-blue-500/10', title: notification.title };
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-[#8A95A5] hover:text-white hover:bg-white/5 rounded-lg transition-colors focus:outline-none"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <div className="absolute top-1 right-1 bg-rose-500 text-white min-w-[16px] h-4 rounded-full flex items-center justify-center text-[10px] font-bold px-1 border-2 border-[#11141A]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </div>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-[#11141A] border border-[#202735] rounded-xl shadow-2xl overflow-hidden z-50 origin-top-right">
          <div className="flex items-center justify-between p-4 border-b border-[#202735] bg-[#0A0D12]">
            <h3 className="font-bold text-white tracking-wide">Notifications</h3>
            {unreadCount > 0 && (
              <button 
                onClick={markAllAsRead}
                className="text-[10px] uppercase font-bold tracking-widest text-[#8A95A5] hover:text-white transition-colors flex items-center gap-1"
              >
                <Check className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-[#5D6B80]">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm font-medium">No new notifications</p>
              </div>
            ) : (
              <div className="divide-y divide-[#202735]">
                {notifications.map(notification => {
                  const { icon: Icon, colorClass, bgClass, title } = getNotificationStyles(notification);
                  
                  return (
                  <div 
                    key={notification.id} 
                    className={cn(
                      "p-4 hover:bg-[#0D1017] transition-colors relative group",
                      !notification.is_read ? "bg-[#11141A]" : "opacity-75"
                    )}
                  >
                    {!notification.is_read && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>
                    )}
                    <div className="flex justify-between items-start gap-3">
                      <div className={cn("p-2 rounded mt-0.5", bgClass, colorClass)}>
                         <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1">
                        <h4 className={cn(
                          "text-sm font-bold mb-1",
                          !notification.is_read ? "text-white" : "text-[#8A95A5]"
                        )}>
                          {title}
                        </h4>
                        <p className="text-xs text-[#5D6B80] leading-relaxed">
                          {notification.message}
                        </p>
                        <p className="text-[10px] text-[#5D6B80] font-mono mt-2">
                          {new Date(notification.created_at).toLocaleString()}
                        </p>
                      </div>
                      
                      {!notification.is_read && (
                        <button 
                          onClick={(e) => markAsRead(notification.id, e)}
                          className="text-[#8A95A5] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Mark as read"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )})}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
