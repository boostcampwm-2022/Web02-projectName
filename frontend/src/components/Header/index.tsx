/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import React, { useState } from 'react'
import './style.scss'
import { Link, useNavigate } from 'react-router-dom'
import { ReactComponent as DownIcon } from '@assets/downIcon.svg'
import { ReactComponent as LogoutIcon } from '@assets/logoutIcon.svg'
import { ReactComponent as QuestionIcon } from '@assets/questionIcon.svg'
import usePost from '@hooks/usePost'
import { IResponse } from '@src/types'
import useSWR from 'swr'
import InfoModal from '../InfoModal'

interface headerProps {
  page?: string
  text?: string
}

const Header = ({ page, text }: headerProps) => {
  const postLogout = usePost('/users/logout')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { data: nickname } = useSWR('/users/nickname', () => {
    return '하드코딩된닉네임'
  })
  const navigate = useNavigate()
  const handleLogout = async () => {
    const { data }: IResponse = await postLogout({})

    if (data) navigate('/Signin')
  }
  const handleModalOpen = (e: any) => {
    e.stopPropagation()
    setIsModalOpen(true)
  }
  const handleRenderHeader = () => {
    switch (page) {
      case 'feed':
        return (
          <div className="feed-header">
            <Link className="text-wrapper" to="/feeds">
              <span className="text">{nickname}</span>
              <div className="svg-wrapper">
                <DownIcon />
              </div>
            </Link>
            <button onClick={handleLogout}>
              <div className="svg-wrapper">
                <LogoutIcon />
              </div>
            </button>
          </div>
        )
      default:
        return (
          <div className="default-header">
            <button onClick={handleModalOpen}>
              <div className="svg-wrapper">
                <QuestionIcon />
              </div>
            </button>
            <span>{text}</span>
            <button onClick={handleLogout}>
              <div className="svg-wrapper">
                <LogoutIcon />
              </div>
            </button>
          </div>
        )
    }
  }
  return (
    <>
      {handleRenderHeader()} {isModalOpen && <InfoModal isModalOpen={isModalOpen} setModalOpen={setIsModalOpen} />}
    </>
  )
}

export default Header
