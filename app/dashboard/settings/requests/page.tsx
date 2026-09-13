'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ExportStockExcel } from '@/components/ExportStockExcel'

export default function RepairRequestListPage() {
  const router = useRouter()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  // Search & Filter state for batches
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  // View mode & Tech stock state
  const [viewMode, setViewMode] = useState<'batches' | 'tech_stock'>('batches')
  const [technicians, setTechnicians] = useState([])
  const [selectedTechId, setSelectedTechId] = useState('')
  const [techStockRows, setTechStockRows] = useState([])

  useEffect(() => {
    fetchRequests()
    fetchTechnicians()
  }, [])

  async function fetchTechnicians() {
    const { data } = await supabase
      .from('technicians_vendors')
      .select('id, name')
      .eq('active', true)
    if (data && data.length > 0) {
      setTechnicians(data)
      setSelectedTechId(data[0].id)
    }
  }

  useEffect(() => {
    if (viewMode === 'tech_stock' && selectedTechId) {
      supabase.rpc('get_technician_stock', {
        target_tech_id: selectedTechId,
        target_date: new Date().toISOString().split('T')[0]
      }).then(({ data }) => setTechStockRows(data || []))
    }
  }, [viewMode, selectedTechId])

  async function fetchRequests() {
    setLoading(true)
    setErrorMsg('')

    const { data: reqs, error: reqError } = await supabase
      .from('repair_requests')
      .select(`
        *,
        repair_request_items (
          id,
          received_at,
          current_status,
          imei
        )
      `)
      .order('created_at', { ascending: false })

    if (reqError) {
      console.error('Error fetching repair requests:', reqError)
      setErrorMsg(reqError.message)
      setLoading(false)
      return
    }

    if (!reqs || reqs.length === 0) {
      setRequests([])
      setLoading(false)
      return
    }

    const userIds = Array.from(new Set(reqs.map(r => r.user_id).filter(Boolean)))
    const profileMap = new Map()

    if (userIds.length > 0) {
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds)

      profilesData?.forEach(p => {
        const name = p.full_name || (p.email ? p.email.split('@')[0] : 'User')
        profileMap.set(p.id, name)
      })
    }

    const formatted = reqs.map(r => {
      const items = r.repair_request_items || []
      let repairedCount = 0
      let rejectionCount = 0
      let pendingCount = 0

      items.forEach((item: any) => {
        const status = (item.current_status || '').trim().toLowerCase()
        if (status === 'repaired') {
          repairedCount += 1
        } else if (status === 'rejected' || status === 'rejection') {
          rejectionCount += 1
        } else {
          pendingCount += 1
        }
      })

      const creatorName = profileMap.get(r.user_id) || 'System User'

      return {
        ...r,
        total_assigned: items.length,
        total_repaired: repairedCount,
        total_rejection: rejectionCount,
        total_pending: pendingCount,
        creator_name: creatorName
      }
    })

    setRequests(formatted)
    setLoading(false)
  }

  const filteredRequests = requests.filter(req => {
    const query = searchQuery.toLowerCase().trim()
    
    const matchesMain = (req.reference_number || '').toLowerCase().includes(query) ||
                        (req.creator_name || '').toLowerCase().includes(query)
                        
    const matchesItem = req.repair_request_items?.some((item: any) => 
      item.imei && item.imei.toLowerCase().includes(query)
    )

    const matchesSearch = !query || matchesMain || matchesItem
    
    if (statusFilter === 'ALL') return matchesSearch
    return matchesSearch && (req.status || '').toUpperCase() === statusFilter.toUpperCase()
  })

  if (loading) {
    return (